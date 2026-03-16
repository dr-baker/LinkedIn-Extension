# LinkedIn JD Extractor

A chrome extension to scrape information from a LinkedIn job post.
It's useful for bookkeeping, and theoretically for human-in-the-loop automation.
It breaks sometimes due to obfuscation.

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select this extension folder (`LinkedIn Extension`)
5. The extension icon will appear in your browser toolbar

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

This repo includes local tooling so you can log into LinkedIn once, then run authenticated DOM probes without sharing credentials.

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
3. Probe an authenticated LinkedIn page and export DOM + selector stats:
   ```bash
   npm run probe:linkedin -- --url "https://www.linkedin.com/jobs/search/" --wait-ms 8000
   ```

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
