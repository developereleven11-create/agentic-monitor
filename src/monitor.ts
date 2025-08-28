// src/monitor.ts
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { notifySlack, Severity } from './notifier.js';
import { diagnose, JourneyLog } from './agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORE_URL = process.env.STORE_URL || 'https://example.com';
const PRODUCT_URL = process.env.PRODUCT_URL || STORE_URL + '/products/example';
const ADD_TO_CART_SELECTOR = process.env.ADD_TO_CART_SELECTOR || 'button[name="add"]';

// Explicit drawer & page selectors (e.g., KwikCart)
const CART_DRAWER_SELECTOR = process.env.CART_DRAWER_SELECTOR || '#CartDrawer';
const CART_PAGE_SELECTOR   = process.env.CART_PAGE_SELECTOR   || 'form[action="/cart"]';

// for dashboard URL building in edge cases
const RUN_BRANCH = process.env.RUN_BRANCH || 'main';

function ensureDir(p: string) { fs.mkdirSync(p, { recursive: true }); }

async function timeStep<T>(name: string, fn: () => Promise<T>, steps: any[]) {
  const t0 = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - t0;
    steps.push({ name, ok: true, ms });
    return result;
  } catch (err: any) {
    const ms = Date.now() - t0;
    const error = err?.message || String(err);
    steps.push({ name, ok: false, ms, error });
    throw err;
  }
}

function persistRun(run: any) {
  const runsDir = path.join(__dirname, '..', 'runs');
  ensureDir(runsDir);
  const indexPath = path.join(runsDir, 'index.json');
  let existing: any[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (!Array.isArray(existing)) existing = [];
  } catch {}
  existing.unshift(run);
  if (existing.length > 500) existing = existing.slice(0, 500);
  fs.writeFileSync(indexPath, JSON.stringify(existing, null, 2));
}

type CartMode = 'drawer' | 'page';

async function runJourney() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const steps: any[] = [];
  ensureDir('screenshots');

  let severity: Severity = 'OK';
  let summary = '';
  let log: JourneyLog = { steps: [], startedAt: new Date().toISOString(), storeUrl: STORE_URL };
  let screenshotPath: string | null = null;
  let cartMode: CartMode | null = null;

  try {
    // homepage
    await timeStep('homepage', async () => {
      await page.goto(STORE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 60000 });
    }, steps);

    // product page
    await timeStep('product_page', async () => {
      await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector(ADD_TO_CART_SELECTOR, { timeout: 15000 });
    }, steps);

    // add to cart — race drawer vs URL
    await timeStep('add_to_cart', async () => {
      await page.click(ADD_TO_CART_SELECTOR, { timeout: 15000 });

      const drawerWait: Promise<CartMode | null> = page
        .waitForSelector(CART_DRAWER_SELECTOR, { timeout: 3000 })
        .then(() => 'drawer' as CartMode)
        .catch(() => null);

      const urlWait: Promise<CartMode | null> = page
        .waitForURL(/\/cart/, { timeout: 10000 })
        .then(() => 'page' as CartMode)
        .catch(() => null);

      const first = await Promise.any([drawerWait, urlWait]).catch(() => null as CartMode | null);
      if (!first) throw new Error('Cart not detected (drawer or /cart).');
      cartMode = first;
    }, steps);

    // cart loaded check (based on mode)
    await timeStep('cart_loaded', async () => {
      if (cartMode === 'drawer') {
        const visible = await page.locator(CART_DRAWER_SELECTOR).first().isVisible().catch(() => false);
        if (!visible) throw new Error('Drawer not visible after add to cart.');
      } else if (cartMode === 'page') {
        const visible = await page.locator(CART_PAGE_SELECTOR).first().isVisible().catch(() => false);
        const onUrl = /\/cart/.test(page.url());
        if (!visible && !onUrl) throw new Error('Cart page not detected after add to cart.');
      } else {
        throw new Error('Cart mode unknown after add to cart.');
      }
    }, steps);

    // Success path
    log = { steps, startedAt: new Date().toISOString(), storeUrl: STORE_URL };
    const anyStepFailed = steps.some((s: any) => !s.ok);
    const anyStepSlow = steps.some((s: any) => s.ms > 8000);
    severity = anyStepFailed ? 'FAIL' : anyStepSlow ? 'WARN' : 'OK';
    summary = await diagnose(log);

    // ✅ Screenshot: crop drawer element if present, else cart form/full page
    if (cartMode === 'drawer') {
      const el = page.locator(CART_DRAWER_SELECTOR).first();
      await el.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
      const fn = path.join('screenshots', `success-drawer-${Date.now()}.png`);
      try {
        await el.screenshot({ path: fn });
        screenshotPath = fn;
      } catch {
        await page.screenshot({ path: fn, fullPage: true });
        screenshotPath = fn;
      }
    } else {
      const el = page.locator(CART_PAGE_SELECTOR).first();
      const fn = path.join('screenshots', `success-cart-${Date.now()}.png`);
      try {
        if (await el.count()) {
          await el.screenshot({ path: fn });
        } else {
          await page.screenshot({ path: fn, fullPage: true });
        }
        screenshotPath = fn;
      } catch {
        await page.screenshot({ path: fn, fullPage: true });
        screenshotPath = fn;
      }
    }

    await notifySlack(
      'Shopify WatchDog',
      { summary, log, url: { STORE_URL, PRODUCT_URL }, screenshot: screenshotPath || undefined },
      severity
    );
  } catch (e: any) {
    // Failure path
    const fn = path.join('screenshots', `failure-${Date.now()}.png`);
    try { await page.screenshot({ path: fn, fullPage: true }); screenshotPath = fn; } catch {}
    const failSteps: any[] = [{ name: 'fatal', ok: false, ms: 0, error: e?.message || String(e) }];
    log = { steps: failSteps, startedAt: new Date().toISOString(), storeUrl: STORE_URL };
    severity = 'FAIL';
    summary = await diagnose(log);

    await notifySlack(
      'Shopify WatchDog',
      {
        summary,
        log,
        url: { STORE_URL, PRODUCT_URL },
        error: e?.message || String(e),
        screenshot: screenshotPath || undefined
      },
      'FAIL'
    );
  } finally {
    // Persist for dashboard (include cartMode + branch in meta)
    const runRecord = {
      id: Date.now(),
      severity,
      summary,
      log,
      url: { STORE_URL, PRODUCT_URL },
      screenshot: screenshotPath,
      meta: { cartMode, branch: RUN_BRANCH },
    };
    try { persistRun(runRecord); } catch (e) { console.error('Persist error:', e); }
    await ctx.close();
    await browser.close();
  }
}

runJourney().catch(err => {
  console.error(err);
  process.exit(1);
});
