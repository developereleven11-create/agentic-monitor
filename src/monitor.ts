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
const CART_VERIFY_SELECTOR = process.env.CART_VERIFY_SELECTOR || 'form[action="/cart"]';

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

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

async function runJourney() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const steps: any[] = [];
  const screenshotsDir = 'screenshots';
  ensureDir(screenshotsDir);

  let severity: Severity = 'OK';
  let summary = '';
  let log: JourneyLog = { steps: [], startedAt: new Date().toISOString(), storeUrl: STORE_URL };
  let screenshotPath: string | null = null;

  try {
    await timeStep('homepage', async () => {
      await page.goto(STORE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 60000 });
    }, steps);

    await timeStep('product_page', async () => {
      await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector(ADD_TO_CART_SELECTOR, { timeout: 15000 });
    }, steps);

    await timeStep('add_to_cart', async () => {
  await page.click(ADD_TO_CART_SELECTOR, { timeout: 15000 });

  // Try a short drawer check first (if your theme has it),
  // then fall back to cart URL. This avoids burning 8s.
  try {
    await page.waitForSelector(CART_VERIFY_SELECTOR, { timeout: 2000 });
  } catch {
    await page.waitForURL(/\/cart/, { timeout: 10000 });
  }
}, steps);

    await timeStep('cart_loaded', async () => {
      const hasCart = await page.locator(CART_VERIFY_SELECTOR).first().isVisible().catch(() => false);
      if (!hasCart && !/\/cart/.test(page.url())) {
        throw new Error('Cart not detected after add to cart.');
      }
    }, steps);

    // success path
    log = { steps, startedAt: new Date().toISOString(), storeUrl: STORE_URL };
    const anyFail = steps.some((s: any) => !s.ok);
    const anySlow = steps.some((s: any) => s.ms > 8000);
    severity = anyFail ? 'FAIL' : anySlow ? 'WARN' : 'OK';
    summary = await diagnose(log);

    await notifySlack(
      'Shopify Journey Monitor',
      { summary, log, url: { STORE_URL, PRODUCT_URL } },
      severity
    );
  } catch (e: any) {
    // failure path
    const fn = path.join('screenshots', `failure-${Date.now()}.png`);
    try { await page.screenshot({ path: fn, fullPage: true }); screenshotPath = fn; } catch {}
    const failSteps: any[] = [{ name: 'fatal', ok: false, ms: 0, error: e?.message || String(e) }];
    log = { steps: failSteps, startedAt: new Date().toISOString(), storeUrl: STORE_URL };
    severity = 'FAIL';
    summary = await diagnose(log);

    await notifySlack(
      'Shopify Journey Monitor',
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
    // persist for dashboard
    const runRecord = {
      id: Date.now(),
      severity,
      summary,
      log,
      url: { STORE_URL, PRODUCT_URL },
      screenshot: screenshotPath,
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
