# LinkedIn JD Extractor

A chrome extension to scrape information from a LinkedIn job post.
It's useful for bookkeeping, and theoretically for human-in-the-loop automation.
It breaks sometimes due to obfuscation.

## Installation

If you already have a built release zip:

1. Download `LinkedIn-JD-Extractor-<version>.zip`
2. Unzip it anywhere on disk
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable **Developer mode** (toggle in the top-right corner)
5. Click **Load unpacked**
6. Select the unzipped folder
7. The extension icon will appear in your browser toolbar

## Build

Use `make build`.

It creates:
- `build/unpacked/` for **Load unpacked**
- `build/LinkedIn-JD-Extractor-<version>.zip` for upload/distribution
- `build/version.json` with the built artifact metadata

## Release

Use the same build path for every release:

1. Run `make build`
2. Create a GitHub release for the current version tag
3. Upload `build/LinkedIn-JD-Extractor-<version>.zip` as the release asset
4. Tell users to download that zip, unzip it, and load the extracted folder via `chrome://extensions`

Do not ship the raw repository. The release zip is the distribution artifact.

### Usage

1. Navigate to any LinkedIn job page (e.g., `linkedin.com/jobs/...`)
2. Click on a job listing to view its details
3. Click the extension icon in your toolbar
4. View extracted job information in the popup
5. Use **Copy to Clipboard** or **Download JSON** to export the data

## Extracted Data

The extension extracts the following information when available:

| Field | Description |
|-------|-------------|
| **Title** | Job title/position |
| **Company** | Hiring company name |
| **Location** | Job location |
| **Work Type** | Remote, Hybrid, or On-site |
| **Salary** | Salary range if listed |
| **Posted Date** | When the job was posted |
| **Applicants** | Number of applicants |
| **Description** | Full job description text |
| **Skills** | Required/preferred skills |
| **Benefits** | Listed benefits (401k, health, etc.) |


## Development

### Authenticated LinkedIn DOM Exploration (Playwright)

This is optional developer tooling. It is not required to build, package, or install the extension.

These scripts let you log into LinkedIn once, then run authenticated DOM probes without sharing credentials.

1. Install dependencies:
   ```bash
   npm install
   ```
2. Capture LinkedIn auth state (opens a visible browser):
   ```bash
   npm run auth:linkedin
   ```
   - Log in manually in the opened browser window.
   - The script detects a valid session and saves it to `.auth/linkedin-storage.json`.
   - Treat `.auth/linkedin-storage.json` as sensitive. It can contain active LinkedIn session cookies.
3. Probe an authenticated LinkedIn page and export DOM + selector stats:
   ```bash
   npm run probe:linkedin -- --url "https://www.linkedin.com/jobs/search/" --wait-ms 8000
   ```
   - Treat probe output as sensitive. `dom.html`, screenshots, and selector summaries can capture private account data, job content, and session-adjacent page state.

Probe output is written to `debug/linkedin-dom/<timestamp>/`:
- `dom.html`: Full HTML snapshot
- `page.png`: Full-page screenshot
- `selector-stats.json`: Per-selector match counts and query timing
- `summary.json`: Best candidate selector per extraction group

### Updating Selectors

LinkedIn's HTML structure may change over time. If extraction stops working:

1. Open `content.js`
2. Update the selectors in the `SELECTORS` object
3. Use Chrome DevTools to inspect LinkedIn's current HTML structure
4. Reload the extension in `chrome://extensions/`

### Debugging

- Open popup DevTools: Right-click extension icon → Inspect popup
- Console logs from content script: Open DevTools on the LinkedIn page
- Access extractor directly: `window.__linkedinJDExtractor.extract()` in console

### Debugging

Open the browser's DevTools Console on a LinkedIn job page and use these commands:

```javascript
// Test all selectors
window.__linkedinJDExtractor.debug.testSelectors()

// Extract job data manually
window.__linkedinJDExtractor.extract().then(console.log)

// Test individual extractors
window.__linkedinJDExtractor.debug.findSalary()
window.__linkedinJDExtractor.debug.findDescription()
window.__linkedinJDExtractor.debug.findTitle()
window.__linkedinJDExtractor.debug.findCompany()
```

## Notes

- This extension only works on LinkedIn job pages
- Some fields may not be available for all job listings
- LinkedIn's structure may change; selectors may need updates
- Arc browser users may need to manually trigger extraction after page load
- `.auth/` and `debug/linkedin-dom/` are gitignored local artifacts and should not be shared casually
