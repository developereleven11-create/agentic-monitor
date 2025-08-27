
# AI Agent Monitor (Shopify synthetic journey)

A simple agent that runs a synthetic buyer journey using Playwright and posts an alert to Slack (and optionally uses OpenAI to craft a human-readable diagnosis). Designed to run on **GitHub Actions (cron)** so you don't need servers.

## What it does
1) Opens your homepage
2) Opens a product page
3) Tries to click Add to Cart (selectors configurable)
4) Verifies cart page loads
5) Measures timings & captures a screenshot on failure
6) If anything breaks or is slow, it **notifies Slack**. If `OPENAI_API_KEY` is set, it also asks the model to summarize likely cause & next steps.

---

## 1) One-time setup

- Create a **new GitHub repo** and upload this zip's contents.
- In your repo, go to **Settings → Secrets and variables → Actions** and add these **Repository secrets**:

```
STORE_URL=https://YOURSTORE.com
PRODUCT_URL=https://YOURSTORE.com/products/your-product-handle
ADD_TO_CART_SELECTOR=button[name="add"]
CART_VERIFY_SELECTOR=form[action="/cart"]  # Any selector that exists on your cart page
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ  # Optional but recommended
OPENAI_API_KEY=sk-...  # Optional
```

> Tip: Inspect your product page to confirm the correct Add-to-Cart selector. If you're on a Shopify theme like Dawn, `button[name="add"]` usually works.

---

## 2) How to run (no servers)
This repo includes a GitHub Actions workflow that runs the agent **every 15 minutes** by default.

- After pushing to `main`, GitHub will automatically run the **Monitor** workflow on schedule.
- You can also run it manually from the **Actions** tab → **Run workflow**.

---

## 3) Files you'll care about

- `src/monitor.ts` — Runs the synthetic journey with Playwright
- `src/agent.ts` — Turns raw logs into a human-readable diagnosis (uses OpenAI if available)
- `src/notifier.ts` — Slack webhook wrapper
- `.github/workflows/monitor.yml` — The cron job runner
- `playwright.config.ts` — Playwright config

---

## 4) What you'll see in Slack
- A status (OK / WARN / FAIL)
- Timings for each step
- A concise diagnosis (AI-generated if key provided)
- A link to the failing screenshot artifact (if any)

---

## 5) Local run (optional)
```bash
npm i
npx playwright install --with-deps
npm run monitor
```

---

## 6) Customize
- Edit selectors in repo **Secrets** (or change defaults in `src/monitor.ts`).
- Add more steps (e.g., checkout start) inside `runJourney()`.
- Pipe results into WhatsApp, Notion, or Jira by extending `src/notifier.ts`.
