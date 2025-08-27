
import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
});
