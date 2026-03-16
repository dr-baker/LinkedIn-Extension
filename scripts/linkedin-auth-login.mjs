#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const AUTH_DIR = path.resolve('.auth');
const AUTH_STATE_PATH = path.join(AUTH_DIR, 'linkedin-storage.json');
const LOGIN_URL = 'https://www.linkedin.com/login';

async function waitForLinkedInAuth(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const currentUrl = page.url();
    const cookies = await page.context().cookies('https://www.linkedin.com');
    const hasLiAtCookie = cookies.some((cookie) => cookie.name === 'li_at');

    if (hasLiAtCookie && /linkedin\.com\//i.test(currentUrl) && !/\/login/i.test(currentUrl)) {
      return { authenticated: true, currentUrl };
    }

    await page.waitForTimeout(1000);
  }

  return { authenticated: false, currentUrl: page.url() };
}

async function main() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('\nOpen browser launched. Please complete LinkedIn login manually.');
  console.log('This script waits up to 10 minutes for a valid authenticated session.\n');

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });

  const result = await waitForLinkedInAuth(page, 10 * 60 * 1000);

  if (!result.authenticated) {
    await browser.close();
    console.error(`Login was not detected before timeout. Last URL: ${result.currentUrl}`);
    process.exit(1);
  }

  await context.storageState({ path: AUTH_STATE_PATH });
  await browser.close();

  console.log(`LinkedIn auth state saved to: ${AUTH_STATE_PATH}`);
  console.log('You can now run: npm run probe:linkedin -- --url "https://www.linkedin.com/jobs/search/"');
}

main().catch((error) => {
  console.error('Failed to capture LinkedIn auth state:', error);
  process.exit(1);
});
