
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { notifySlack, Severity } from './notifier.js';
import { diagnose, JourneyLog } from './agent.js';

const STORE_URL = process.env.STORE_URL || 'https://example.com';
const PRODUCT_URL = process.env.PRODUCT_URL || STORE_URL + '/products/example';
const ADD_TO_CART_SELECTOR = process.env.ADD_TO_CART_SELECTOR || 'button[name="add"]';
const CART_VERIFY_SELECTOR = process.env.CART_VERIFY_SELECTOR || 'form[action="/cart"]';

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

async function runJourney() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const steps: any[] = [];
  const screenshotsDir = 'screenshots';
  fs.mkdirSync(screenshotsDir, { recursive: true });

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
      // Many themes open a cart drawer; try both drawer and cart page verification.
      try {
        await page.waitForSelector(CART_VERIFY_SELECTOR, { timeout: 8000 });
      } catch {
        // Fallback: look for /cart in URL
        await page.waitForURL(/\/cart/, { timeout: 8000 });
      }
    }, steps);

    await timeStep('cart_loaded', async () => {
      // A simple cart existence check
      const hasCart = await page.locator(CART_VERIFY_SELECTOR).first().isVisible().catch(() => false);
      if (!hasCart && !/\/cart/.test(page.url())) {
        throw new Error('Cart not detected after add to cart.');
      }
    }, steps);

    const log: JourneyLog = {
      steps,
      startedAt: new Date().toISOString(),
      storeUrl: STORE_URL,
    };

    // Decide severity
    const anyFail = steps.some((s: any) => !s.ok);
    const anySlow = steps.some((s: any) => s.ms > 8000);
    const severity: Severity = anyFail ? 'FAIL' : anySlow ? 'WARN' : 'OK';

    const summary = await diagnose(log);

    await notifySlack('Shopify Journey Monitor', { summary, log, url: { STORE_URL, PRODUCT_URL } }, severity);
  } catch (e: any) {
    const fn = path.join('screenshots', `failure-${Date.now()}.png`);
    try { await page.screenshot({ path: fn, fullPage: true }); } catch {}
    const steps: any[] = [{ name: 'fatal', ok: false, ms: 0, error: e?.message || String(e) }];
    const log: JourneyLog = { steps, startedAt: new Date().toISOString(), storeUrl: STORE_URL };
    const summary = await diagnose(log);
    await notifySlack('Shopify Journey Monitor', { summary, error: e?.message, screenshot: fn }, 'FAIL');
  } finally {
    await ctx.close();
    await browser.close();
  }
}

runJourney().catch(err => {
  console.error(err);
  process.exit(1);
});
