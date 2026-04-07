# LinkedIn job page style parsing fix

## Goal
Improve LinkedIn job extraction so the extension can parse newer job page layouts, including direct job pages that don’t expose the older stable job detail classes reliably.

## TODO
- [x] Inspect the current LinkedIn extraction flow and identify the weakest selectors/fallbacks for newer job layouts.
- [x] Add more resilient LinkedIn-specific fallbacks for title, company, location, description, salary, work type, employment type, posted date, and applicants using visible page text and section anchors.
- [x] Verify the extractor still prefers structured selectors when available and only falls back to broader heuristics when needed.
- [x] Sanity-check the updated logic against the exported LinkedIn job page HTML and summarize the behavior change.

## Progress Notes
- 2026-04-04: Started investigation of the LinkedIn job extraction code. The current parser leans heavily on class-based selectors and a largest-text-block fallback, which is fragile for newer LinkedIn job layouts.
- 2026-04-04: Added broader LinkedIn fallbacks for generic headings, document-title parsing, visible company links, and section-anchored description extraction. Also added main-text fallbacks for salary, work type, employment type, posted date, and applicants.
- 2026-04-04: Tightened title detection so employment labels like “Full-time” are rejected as job titles, and preferred document/meta title sources ahead of broad visible-heading fallbacks.
- 2026-04-04: Ran a syntax check on `content.js` after patching; the file now passes `node --check`.

## Final notes and learnings
- LinkedIn’s newer job pages can still render enough visible text to extract reliably even when the older stable class names are missing.
- The extractor now prefers specific selectors first, then falls back to heading/title heuristics and text anchoring so it is less dependent on a single page layout.
