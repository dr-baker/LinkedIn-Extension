# LinkedIn JD Extractor

A Chrome browser extension that extracts job description information from LinkedIn job pages.

## Features

- 📋 **Extract Job Details**: Title, company, location, salary, work type, and more
- 📝 **Full Description**: Captures the complete job description text
- 🛠️ **Skills & Benefits**: Extracts required skills and listed benefits
- 📋 **Copy to Clipboard**: One-click copy of formatted job details
- 💾 **Download JSON**: Export job data as a JSON file for further processing

## Installation

### Developer Mode (Recommended for Testing)

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

## File Structure

```
LinkedIn Extension/
├── manifest.json      # Extension configuration
├── popup.html         # Popup UI markup
├── popup.css          # Popup styling
├── popup.js           # Popup logic
├── content.js         # Page content extraction
├── content-styles.css # Content script styles
├── icons/             # Extension icons (SVG)
└── README.md          # This file
```

## Development

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

## Troubleshooting

### Extension doesn't extract data in Arc Browser

Arc browser may have timing issues with content script injection. Try these solutions:

1. **Wait for page to fully load**: Give the page a few seconds to fully render before clicking the extension
2. **Refresh and retry**: Click the Refresh button in the extension popup
3. **Check permissions**: Go to `arc://extensions` → LinkedIn JD Extractor → Ensure "Site access" is set to "On all sites" or at least "On www.linkedin.com"
4. **Disable Arc Boosts**: Some Arc Boosts may interfere with LinkedIn's page structure

### Salary not parsing correctly

The extension looks for salary patterns like `$XXX,XXX/yr` or `$XXXK`. If salary isn't extracted:

1. Open DevTools Console (F12 or Cmd+Option+I)
2. Run: `window.__linkedinJDExtractor.debug.findSalary()`
3. This will show what salary data (if any) was found

### Job description not found

1. Ensure you've clicked on a specific job listing (not just the search results page)
2. Wait for the job details panel to load on the right side
3. Open DevTools Console and run: `window.__linkedinJDExtractor.debug.testSelectors()`
4. This will show which selectors are finding elements

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

## License

MIT License - Feel free to modify and distribute.

