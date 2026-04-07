# Add BuiltIn Scraper Support

## Goal
Enable the extension to scrape job details from BuiltIn.com job postings, extracting title, company, location, salary, description, and other relevant fields.

## TODO
- [x] Research BuiltIn.com DOM structure and JSON-LD data
- [x] Create a site detection mechanism in `content.js`
- [x] Implement BuiltIn-specific extraction logic
    - [x] Try extracting from JSON-LD first
    - [x] Implement DOM fallback selectors for title, company, location, etc.
- [x] Update `extractJobData` to route to the correct site scraper
- [x] Verify extraction on the provided BuiltIn link
- [x] Test with a few other BuiltIn job links if possible

## Progress Notes
- 2026-04-03: Initial research via `curl` shows rich JSON-LD data available on BuiltIn job pages.
- 2026-04-03: Implemented BuiltIn scraper using JSON-LD, `Builtin.jobPostInit` script, and DOM fallbacks.
- 2026-04-03: Updated `manifest.json` and popup UI to support multiple sites.

## Final notes and learnings
- BuiltIn.com provides rich structured data via JSON-LD and a global `Builtin.jobPostInit` script, making extraction very reliable.
- Updated `manifest.json` to include BuiltIn permissions.
- Updated `popup.js` and `popup.html` to be site-agnostic where possible.
