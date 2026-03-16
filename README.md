# LinkedIn JD Extractor

A chrome extension to scrape information from a LinkedIn job post.
It's useful for bookkeeping, and theoretically for human-in-the-loop automation.
It breaks sometimes due to obfuscation.

## Easy install (just use it)

1. Open Chrome and go to `chrome://extensions/`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Pick this folder (`LinkedIn Extension`)
5. Open a LinkedIn job page, then click the extension icon.

## Build

Use `make build`.

It creates:
- `build/unpacked/` for **Load unpacked**
- `build/LinkedIn-JD-Extractor-<version>.zip` for upload/distribution
- `build/version.json` with the built artifact metadata

### Usage

1. Navigate to any LinkedIn job page (e.g., `linkedin.com/jobs/...`)
2. Click on a job listing to view its details
3. Click the extension icon in your toolbar
4. View extracted job information in the popup
5. Use **Copy to Clipboard** or **Download JSON** to export the data

## If LinkedIn changes its markup:

```javascript
window.__linkedinJDExtractor.debug.testSelectors()
window.__linkedinJDExtractor.extract().then(console.log)
window.__linkedinJDExtractor.debug.findSalary()
window.__linkedinJDExtractor.debug.findDescription()
window.__linkedinJDExtractor.debug.findTitle()
window.__linkedinJDExtractor.debug.findCompany()
```

1. Open `content.js`
2. Update the `SELECTORS` object
3. Reload the extension in `chrome://extensions/`
4. Test on a LinkedIn job page

Optional Playwright tooling is available if you need an authenticated DOM snapshot:

```bash
npm install
npm run auth:linkedin
npm run probe:linkedin -- --url "https://www.linkedin.com/jobs/search/" --wait-ms 8000
```

This writes output to `debug/linkedin-dom/<timestamp>/`. Treat `.auth/` and `debug/linkedin-dom/` as sensitive.

## Notes

- This extension only works on LinkedIn job pages
- Some fields break on some listing paths
- LinkedIn's structure may change; selectors may need updates
- Arc browser users may need to manually trigger extraction after page load
