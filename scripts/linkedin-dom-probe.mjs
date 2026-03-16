#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const AUTH_STATE_PATH = path.resolve('.auth/linkedin-storage.json');
const DEFAULT_URL = 'https://www.linkedin.com/jobs/search/';

const SELECTOR_GROUPS = {
  jobDetailContainer: [
    '.jobs-details',
    '.job-details-jobs-unified-top-card__container--two-pane',
    '.jobs-unified-top-card',
    '.jobs-search__job-details',
    '.scaffold-layout__detail',
    '.jobs-search-two-pane__detail',
    '.jobs-search-two-pane__job-details',
    '[class*="two-pane__detail"]',
    '[class*="jobs-details"]',
    '[class*="job-details"]'
  ],
  jobTitle: [
    '.job-details-jobs-unified-top-card__job-title h1',
    '.job-details-jobs-unified-top-card__job-title a',
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title',
    'h1[class*="job-title"]',
    'h1[class*="job-details"]',
    'h2[class*="job-title"]',
    '.t-24.t-bold',
    'a[class*="job-title"]',
    '.jobs-details-top-card__job-title',
    '.jobs-search__job-details h1',
    '.jobs-search__job-details h2'
  ],
  companyName: [
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name a',
    '.jobs-unified-top-card__company-name',
    'a[class*="company-name"]',
    '[class*="topcard"] a[href*="/company/"]',
    '.jobs-details-top-card__company-url',
    'a[data-tracking-control-name*="company"]',
    '.topcard__org-name-link'
  ],
  location: [
    '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
    '.job-details-jobs-unified-top-card__primary-description-container span',
    '.jobs-unified-top-card__bullet',
    '.jobs-details-top-card__bullet',
    '[class*="primary-description"] span',
    '.topcard__flavor--bullet'
  ],
  description: [
    '.jobs-description__content',
    '.jobs-description-content__text',
    '.jobs-box__html-content',
    '#job-details',
    '.description__text',
    '[class*="jobs-description"]',
    '.jobs-description',
    'article[class*="jobs-description"]',
    '.jobs-search__job-details article',
    '.jobs-search__job-details section'
  ],
  skills: [
    '.job-details-how-you-match__skills-item',
    '.jobs-unified-top-card__job-insight-text-button',
    '.job-details-skill-match-modal__skill-name',
    '[class*="skill-match"] span',
    '[class*="skills-item"]'
  ]
};

function parseArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1 || idx === process.argv.length - 1) return fallback;
  return process.argv[idx + 1];
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function main() {
  if (!fs.existsSync(AUTH_STATE_PATH)) {
    console.error(`Missing auth state file: ${AUTH_STATE_PATH}`);
    console.error('Run: npm run auth:linkedin');
    process.exit(1);
  }

  const url = parseArg('--url', DEFAULT_URL);
  const waitMs = Number.parseInt(parseArg('--wait-ms', '6000'), 10);
  const outRoot = path.resolve(parseArg('--out-dir', 'debug/linkedin-dom'));
  const outDir = path.join(outRoot, nowStamp());
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: AUTH_STATE_PATH });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(waitMs);

  const selectorStats = await page.evaluate((selectorGroups) => {
    const makeStableSelector = (el) => {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';

      const testAttributes = ['data-test-id', 'data-control-name', 'aria-label', 'role'];
      for (const name of testAttributes) {
        const value = el.getAttribute(name);
        if (value) {
          return `${el.tagName.toLowerCase()}[${name}="${CSS.escape(value)}"]`;
        }
      }

      if (el.id) return `#${CSS.escape(el.id)}`;

      const classes = Array.from(el.classList)
        .filter((c) => c && !/\d{3,}/.test(c))
        .slice(0, 3)
        .map((c) => `.${CSS.escape(c)}`)
        .join('');

      return `${el.tagName.toLowerCase()}${classes}`;
    };

    const sampleText = (nodes) => {
      return Array.from(nodes)
        .slice(0, 3)
        .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    };

    const results = {};

    for (const [groupName, selectors] of Object.entries(selectorGroups)) {
      results[groupName] = [];

      for (const selector of selectors) {
        let totalMs = 0;
        let count = 0;
        let error = '';
        let firstStableSelector = '';
        let texts = [];

        for (let i = 0; i < 10; i += 1) {
          try {
            const t0 = performance.now();
            const nodes = document.querySelectorAll(selector);
            const t1 = performance.now();

            totalMs += t1 - t0;

            if (i === 0) {
              count = nodes.length;
              if (count > 0) {
                firstStableSelector = makeStableSelector(nodes[0]);
                texts = sampleText(nodes);
              }
            }
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            break;
          }
        }

        results[groupName].push({
          selector,
          count,
          avgMs: Number((totalMs / 10).toFixed(4)),
          firstStableSelector,
          sampleTexts: texts,
          error
        });
      }
    }

    return {
      results,
      url: location.href,
      title: document.title,
      domElementCount: document.querySelectorAll('*').length
    };
  }, SELECTOR_GROUPS);

  const html = await page.content();
  await page.screenshot({ path: path.join(outDir, 'page.png'), fullPage: true });

  fs.writeFileSync(path.join(outDir, 'dom.html'), html, 'utf8');
  fs.writeFileSync(path.join(outDir, 'selector-stats.json'), JSON.stringify(selectorStats, null, 2));

  const summary = Object.fromEntries(
    Object.entries(selectorStats.results).map(([groupName, entries]) => {
      const best = entries
        .filter((entry) => !entry.error)
        .sort((a, b) => {
          if (a.count !== b.count) return b.count - a.count;
          return a.avgMs - b.avgMs;
        })[0];

      return [groupName, best || null];
    })
  );

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

  await browser.close();

  console.log(`Probe complete for ${selectorStats.url}`);
  console.log(`Output directory: ${outDir}`);
  console.log('Files: dom.html, page.png, selector-stats.json, summary.json');
}

main().catch((error) => {
  console.error('LinkedIn DOM probe failed:', error);
  process.exit(1);
});
