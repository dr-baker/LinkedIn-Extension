#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const DEFAULT_FIXTURES_ROOT = 'debug/linkedin-dom-test';
const DEFAULT_EXPECTED_FILE = 'expected-export.json';
const DEFAULT_ACTUAL_FILE = 'parsed-actual.json';

function parseArgs(argv) {
  const args = {
    fixtures: DEFAULT_FIXTURES_ROOT,
    strategy: 'robust',
    writeActual: false,
    updateExpected: false,
    expectedFile: DEFAULT_EXPECTED_FILE,
    actualFile: DEFAULT_ACTUAL_FILE,
    json: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--fixtures' || arg === '--fixture') {
      args.fixtures = next;
      i += 1;
    } else if (arg === '--strategy') {
      args.strategy = next || args.strategy;
      i += 1;
    } else if (arg === '--expected-file') {
      args.expectedFile = next || args.expectedFile;
      i += 1;
    } else if (arg === '--actual-file') {
      args.actualFile = next || args.actualFile;
      i += 1;
    } else if (arg === '--write-actual') {
      args.writeActual = true;
    } else if (arg === '--update-expected') {
      args.updateExpected = true;
      args.writeActual = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run test:parser -- [options]

Options:
  --fixtures <path>       Probe root or a single probe directory. Default: ${DEFAULT_FIXTURES_ROOT}
  --strategy <name>       Parser strategy to run: robust or legacy. Default: robust
  --write-actual          Write parsed output into each fixture as ${DEFAULT_ACTUAL_FILE}
  --update-expected       Write parsed output as ${DEFAULT_EXPECTED_FILE}
  --expected-file <name>  Expected sidecar filename. Default: ${DEFAULT_EXPECTED_FILE}
  --actual-file <name>    Actual sidecar filename. Default: ${DEFAULT_ACTUAL_FILE}
  --json                  Print machine-readable JSON summary

Expected sidecars compare only the fields they contain. String values compare exactly.
For string fields, matcher objects are also supported:
  {
    "title": "Data Analytics Lead",
    "company": "PayPal",
    "description": {
      "minLength": 1000,
      "startsWith": "The Company",
      "includes": ["PayPal has been revolutionizing"],
      "excludes": ["Jobs based on your preferences"]
    }
  }
`);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function discoverFixtures(inputPath) {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Fixture path does not exist: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Fixture path must be a directory: ${resolved}`);
  }

  if (fs.existsSync(path.join(resolved, 'dom.html'))) {
    return [resolved];
  }

  return fs.readdirSync(resolved)
    .map(name => path.join(resolved, name))
    .filter(dir => fs.statSync(dir).isDirectory())
    .filter(dir => fs.existsSync(path.join(dir, 'dom.html')))
    .sort();
}

function sanitizeHtml(html) {
  return html
    .replace(/<meta[^>]+Content-Security-Policy[^>]*>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '');
}

function getFixtureUrl(fixtureDir) {
  const selectorStats = readJsonIfExists(path.join(fixtureDir, 'selector-stats.json'));
  if (selectorStats?.url) return selectorStats.url;

  const summary = readJsonIfExists(path.join(fixtureDir, 'summary.json'));
  if (summary?.url) return summary.url;

  return 'https://www.linkedin.com/jobs/view/fixture/';
}

function normalizeActual(result) {
  const data = result?.data || {};
  return {
    success: Boolean(result?.success),
    error: result?.error || '',
    title: data.title || '',
    company: data.company || '',
    location: data.location || '',
    workType: data.workType || '',
    employmentType: data.employmentType || '',
    salary: data.salary || '',
    postedDate: data.postedDate || '',
    applicants: data.applicants || '',
    description: data.description || '',
    skills: Array.isArray(data.skills) ? data.skills : [],
    benefits: Array.isArray(data.benefits) ? data.benefits : [],
    companyDescription: data.companyDescription || '',
    url: data.url || '',
    extractedAt: data.extractedAt || ''
  };
}

async function parseFixture(browser, fixtureDir, strategy) {
  const domPath = path.join(fixtureDir, 'dom.html');
  const html = sanitizeHtml(fs.readFileSync(domPath, 'utf8'));
  const url = getFixtureUrl(fixtureDir);
  const contentScript = fs.readFileSync(path.resolve('content.js'), 'utf8');
  const context = await browser.newContext({ bypassCSP: true });
  const page = await context.newPage();

  await page.route('**/*', async route => {
    const request = route.request();
    if (request.resourceType() === 'document') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    } else {
      await route.abort();
    }
  });

  await page.addInitScript((parserStrategy) => {
    window.chrome = {
      runtime: { onMessage: { addListener() {} } },
      storage: {
        sync: {
          get: async () => ({
            settings: {
              parserStrategy,
              promotedJobsMode: 'off',
              autoCopy: false,
              autoSave: false,
              fileFormat: 'text',
              downloadFolder: ''
            }
          })
        },
        onChanged: { addListener() {} }
      }
    };
  }, strategy);

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: contentScript });
  const raw = await page.evaluate(() => window.__linkedinJDExtractor.extract());
  await context.close();

  return normalizeActual(raw);
}

function isMatcherObject(value) {
  return value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    ['equals', 'includes', 'excludes', 'startsWith', 'endsWith', 'minLength', 'maxLength', 'contains'].some(key => key in value);
}

function compareMatcher(field, actualValue, matcher) {
  const failures = [];
  const text = typeof actualValue === 'string' ? actualValue : JSON.stringify(actualValue);

  if ('equals' in matcher && actualValue !== matcher.equals) {
    failures.push(`${field}: expected exact ${JSON.stringify(matcher.equals)}, got ${JSON.stringify(actualValue)}`);
  }

  for (const value of [].concat(matcher.includes || [])) {
    if (!text.includes(value)) failures.push(`${field}: expected to include ${JSON.stringify(value)}`);
  }

  for (const value of [].concat(matcher.excludes || [])) {
    if (text.includes(value)) failures.push(`${field}: expected to exclude ${JSON.stringify(value)}`);
  }

  if ('startsWith' in matcher && !text.startsWith(matcher.startsWith)) {
    failures.push(`${field}: expected to start with ${JSON.stringify(matcher.startsWith)}`);
  }

  if ('endsWith' in matcher && !text.endsWith(matcher.endsWith)) {
    failures.push(`${field}: expected to end with ${JSON.stringify(matcher.endsWith)}`);
  }

  if ('minLength' in matcher && text.length < matcher.minLength) {
    failures.push(`${field}: expected length >= ${matcher.minLength}, got ${text.length}`);
  }

  if ('maxLength' in matcher && text.length > matcher.maxLength) {
    failures.push(`${field}: expected length <= ${matcher.maxLength}, got ${text.length}`);
  }

  if ('contains' in matcher) {
    const actualArray = Array.isArray(actualValue) ? actualValue : [];
    for (const value of [].concat(matcher.contains || [])) {
      if (!actualArray.includes(value)) failures.push(`${field}: expected array to contain ${JSON.stringify(value)}`);
    }
  }

  return failures;
}

function compareExpected(actual, expected) {
  if (!expected) return [];

  const expectedFields = expected.data && typeof expected.data === 'object' ? expected.data : expected;
  const failures = [];

  for (const [field, expectedValue] of Object.entries(expectedFields)) {
    if (field === 'extractedAt') continue;

    const actualValue = actual[field];
    if (isMatcherObject(expectedValue)) {
      failures.push(...compareMatcher(field, actualValue, expectedValue));
    } else if (Array.isArray(expectedValue)) {
      const actualArray = Array.isArray(actualValue) ? actualValue : [];
      const same = expectedValue.length === actualArray.length &&
        expectedValue.every((value, idx) => value === actualArray[idx]);
      if (!same) {
        failures.push(`${field}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualArray)}`);
      }
    } else if (actualValue !== expectedValue) {
      failures.push(`${field}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
    }
  }

  return failures;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function summarizeActual(actual) {
  return {
    title: actual.title,
    company: actual.company,
    location: actual.location,
    workType: actual.workType,
    employmentType: actual.employmentType,
    salary: actual.salary,
    postedDate: actual.postedDate,
    applicants: actual.applicants,
    descriptionLength: actual.description.length,
    descriptionStart: actual.description.slice(0, 160),
    url: actual.url
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const fixtureDirs = discoverFixtures(args.fixtures);
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const fixtureDir of fixtureDirs) {
      const expectedPath = path.join(fixtureDir, args.expectedFile);
      const actualPath = path.join(fixtureDir, args.actualFile);
      const expected = readJsonIfExists(expectedPath);
      const actual = await parseFixture(browser, fixtureDir, args.strategy);
      const failures = compareExpected(actual, expected);

      if (args.writeActual) {
        writeJson(actualPath, actual);
      }

      if (args.updateExpected) {
        writeJson(expectedPath, actual);
      }

      results.push({
        fixture: fixtureDir,
        url: getFixtureUrl(fixtureDir),
        hasExpected: Boolean(expected),
        passed: failures.length === 0,
        failures,
        actual: summarizeActual(actual)
      });
    }
  } finally {
    await browser.close();
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const result of results) {
      const status = result.hasExpected ? (result.passed ? 'PASS' : 'FAIL') : 'INFO';
      console.log(`\n[${status}] ${path.basename(result.fixture)}`);
      console.log(`URL: ${result.url}`);
      console.log(JSON.stringify(result.actual, null, 2));
      if (!result.hasExpected) {
        console.log(`No ${args.expectedFile} sidecar found; wrote no comparison.`);
      }
      for (const failure of result.failures) {
        console.log(`- ${failure}`);
      }
    }
  }

  const failed = results.filter(result => result.hasExpected && !result.passed);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
