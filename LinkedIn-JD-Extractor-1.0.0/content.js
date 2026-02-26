/**
 * LinkedIn Job Description Extractor
 * Content script that extracts job information from LinkedIn job pages
 */

(function() {
  'use strict';

  function cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Get the job detail container using stable attributes.
   * Falls back broadly since [role="main"] may be empty until React hydrates.
   */
  function getJobContainer() {
    return (
      document.querySelector('[data-testid="lazy-column"]') ||
      document.getElementById('lazy-column') ||
      document.querySelector('[data-sdui-screen*="JobDetails"]') ||
      document.querySelector('[data-sdui-screen]') ||
      document.querySelector('[role="main"]') ||
      document.querySelector('.jobs-details') ||
      document.querySelector('[class*="jobs-details"]') ||
      document.querySelector('[class*="job-details"]') ||
      document.body
    );
  }

  /**
   * Extract job title.
   * Tries the container's h1 first, then any h1 on the page.
   */
  function extractTitle() {
    // 1. h1 inside the job container
    const container = getJobContainer();
    if (container && container !== document.body) {
      const h1 = container.querySelector('h1');
      if (h1) {
        const text = cleanText(h1.textContent);
        if (text.length > 3) return text;
      }
    }

    // 2. Any h1 on the page (LinkedIn typically has exactly one — the job title)
    const allH1s = document.querySelectorAll('h1');
    for (const h1 of allH1s) {
      const text = cleanText(h1.textContent);
      if (text.length > 3 && text.length < 250) return text;
    }

    // 3. Legacy class-based selectors
    const legacySelectors = [
      '.job-details-jobs-unified-top-card__job-title h1',
      '.jobs-unified-top-card__job-title',
      'h1[class*="job-title"]',
      'h2[class*="job-title"]',
    ];
    for (const sel of legacySelectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = cleanText(el.textContent);
          if (text.length > 3) return text;
        }
      } catch (e) {}
    }

    return '';
  }

  /**
   * Find the "Company • Location (WorkType)" line.
   * Scans the page for any <p> containing the bullet separator.
   */
  function extractCompanyLine() {
    const h1 = document.querySelector('[data-testid="lazy-column"] h1') ||
                document.querySelector('h1');

    // Walk siblings after h1 first (most precise)
    if (h1) {
      let el = h1.nextElementSibling;
      for (let i = 0; i < 8 && el; i++) {
        const text = cleanText(el.textContent || '');
        if (text.includes(' • ') && text.length < 200) return text;
        el = el.nextElementSibling;
      }

      // Check ancestor's p elements near h1
      let parent = h1.parentElement;
      for (let depth = 0; depth < 5 && parent; depth++) {
        const paras = parent.querySelectorAll('p');
        for (const p of paras) {
          if (p.children.length > 4) continue;
          const text = cleanText(p.textContent || '');
          if (text.includes(' • ') && text.length > 3 && text.length < 200) return text;
        }
        parent = parent.parentElement;
      }
    }

    // Broad fallback: any <p> on the page with the bullet pattern
    const allP = document.querySelectorAll('p');
    for (const p of allP) {
      if (p.children.length > 4) continue;
      const text = cleanText(p.textContent || '');
      if (text.includes(' • ') && text.length > 3 && text.length < 200) return text;
    }

    return null;
  }

  /**
   * Parse "Planet • San Francisco, CA (Hybrid)" into parts.
   */
  function parseCompanyLine(line) {
    if (!line) return { company: '', location: '', workType: '' };

    const parts = line.split(' • ');
    const company = parts[0].trim();
    let locationPart = parts.slice(1).join(' • ').trim();

    let workType = '';
    const wtMatch = locationPart.match(/\((Remote|Hybrid|On-?site)\)/i);
    if (wtMatch) {
      workType = wtMatch[1].replace(/onsite/i, 'On-site');
      locationPart = locationPart.replace(wtMatch[0], '').replace(/,\s*$/, '').trim();
    }

    return { company, location: locationPart, workType };
  }

  /**
   * Extract salary by scanning leaf nodes for a dollar-range pattern.
   */
  function extractSalary() {
    const pattern = /\$[\d,]+(?:\.\d+)?K?\/(?:yr|hr|mo|year|hour)\s*[-–]\s*\$[\d,]+(?:\.\d+)?K?\/(?:yr|hr|mo|year|hour)/i;
    const container = getJobContainer();
    const elements = container.querySelectorAll('p, span, strong, li, div');
    for (const el of elements) {
      if (el.children.length < 3) {
        const match = (el.textContent || '').match(pattern);
        if (match) return cleanText(match[0]);
      }
    }
    return '';
  }

  /**
   * Extract work type. Uses the parsed company line first, then scans pill buttons.
   * Pills render as <button> elements with an icon child + text — don't filter by children count.
   */
  function extractWorkType(companyLineParsed) {
    if (companyLineParsed && companyLineParsed.workType) return companyLineParsed.workType;

    const container = getJobContainer();
    const elements = container.querySelectorAll('button, span, li');
    for (const el of elements) {
      const text = cleanText(el.textContent || '');
      if (text.length > 30) continue; // pills are short
      const lower = text.toLowerCase();
      if (lower.includes('remote')) return 'Remote';
      if (lower.includes('hybrid')) return 'Hybrid';
      if (lower.includes('on-site') || lower.includes('onsite')) return 'On-site';
    }
    return '';
  }

  /**
   * Extract employment type by scanning pill buttons.
   */
  function extractEmploymentType() {
    const container = getJobContainer();
    const elements = container.querySelectorAll('button, span, li');
    for (const el of elements) {
      const text = cleanText(el.textContent || '');
      if (text.length > 40) continue; // pills are short
      const lower = text.toLowerCase();
      if (lower.includes('full-time') || lower.includes('full time')) return 'Full-time';
      if (lower.includes('part-time') || lower.includes('part time')) return 'Part-time';
      if (lower === 'contract') return 'Contract';
      if (lower === 'internship') return 'Internship';
      if (lower === 'temporary') return 'Temporary';
    }
    return '';
  }

  /**
   * Extract posted date.
   * LinkedIn puts the relative time ("1 week ago") in aria-hidden spans.
   */
  function extractPostedDate() {
    // New LinkedIn: relative time is in <span aria-hidden="true">
    const hiddenSpans = document.querySelectorAll('span[aria-hidden="true"]');
    for (const span of hiddenSpans) {
      const text = span.textContent || '';
      if (text.match(/\d+\s*(day|week|month|hour|minute)s?\s*ago/i)) {
        return cleanText(text);
      }
    }

    // Fallback: any leaf span/p with time-ago text
    const elements = document.querySelectorAll('span, p, time');
    for (const el of elements) {
      if (el.children.length > 0) continue;
      const text = el.textContent || '';
      if (text.match(/\d+\s*(day|week|month|hour|minute)s?\s*ago/i)) {
        return cleanText(text);
      }
    }

    return '';
  }

  /**
   * Extract applicants count.
   */
  function extractApplicants() {
    const elements = document.querySelectorAll('span, p');
    for (const el of elements) {
      if (el.children.length > 2) continue;
      const text = el.textContent || '';
      if (text.match(/[\d,]+\s*applicant/i) || text.match(/over\s+\d+.*clicked\s+apply/i)) {
        return cleanText(text);
      }
    }
    return '';
  }

  /**
   * Extract job description.
   * Collects all <p> and <li> elements that appear after the h1 in DOM order,
   * filtered by length to skip header/badge content.
   */
  function extractDescription() {
    const h1 = document.querySelector('[data-testid="lazy-column"] h1') ||
                document.querySelector('h1');
    const container = getJobContainer();

    // Gather all text-bearing elements from the container
    const searchRoot = container || document.body;
    const allElements = searchRoot.querySelectorAll('p, li, h2, h3, h4');

    const descLines = [];
    let pastHeader = !h1; // If no h1 found, include everything

    for (const el of allElements) {
      // Once we pass the h1 in DOM order, start collecting
      if (!pastHeader && h1) {
        const pos = h1.compareDocumentPosition(el);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
          pastHeader = true;
        } else {
          continue;
        }
      }

      const text = cleanText(el.textContent || '');
      if (!text) continue;

      // Skip short badge/pill content
      if (text.length < 20 && el.tagName !== 'H2' && el.tagName !== 'H3' && el.tagName !== 'H4') continue;

      // Skip the company/location line (contains • and is short)
      if (text.includes(' • ') && text.length < 200) continue;

      // Skip time-ago strings
      if (text.match(/^\d+\s*(day|week|month|hour|minute)s?\s*ago$/i)) continue;

      // Avoid duplicating parent text — skip if this el's text is fully contained in last added line
      if (descLines.length > 0 && descLines[descLines.length - 1].includes(text)) continue;

      descLines.push(text);
    }

    if (descLines.length === 0) {
      // Legacy fallback
      const legacySelectors = [
        '.jobs-description__content',
        '.jobs-description-content__text',
        '#job-details',
        '[class*="jobs-description"]',
      ];
      for (const sel of legacySelectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            const text = (el.innerText || el.textContent || '')
              .replace(/[ \t]+/g, ' ')
              .replace(/\n{3,}/g, '\n\n')
              .trim();
            if (text.length > 100) return text;
          }
        } catch (e) {}
      }
      return '';
    }

    return descLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * Extract the canonical job URL.
   */
  function extractJobUrl() {
    const url = window.location.href;
    const match = url.match(/currentJobId=(\d+)/) || url.match(/\/jobs\/view\/(\d+)/);
    if (match) return `https://www.linkedin.com/jobs/view/${match[1]}`;
    return url;
  }

  /**
   * Wait until job content is visible in the DOM.
   * Checks for h1 OR a paragraph with the company-line bullet pattern.
   */
  function waitForJobDetails(timeout = 6000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const hasH1 = !!document.querySelector('h1');
        const hasCompanyLine = !!Array.from(document.querySelectorAll('p')).find(p =>
          p.children.length < 5 && (p.textContent || '').includes(' • ')
        );
        if (hasH1 || hasCompanyLine) { resolve(true); return; }
        if (Date.now() - start > timeout) { resolve(false); return; }
        setTimeout(check, 200);
      };
      check();
    });
  }

  /**
   * Main extraction function.
   */
  async function extractJobData() {
    const url = window.location.href;

    if (!url.includes('/jobs/') && !url.includes('linkedin.com/jobs')) {
      return { error: 'not_linkedin_jobs' };
    }

    await waitForJobDetails();

    const hasCurrentJobId = url.includes('currentJobId=');

    // Check for bare search page with no job selected
    if (!hasCurrentJobId && !url.includes('/jobs/view/')) {
      const jobsList = document.querySelector(
        '[data-testid="jobs-search-results-list"], .scaffold-layout__list, [class*="jobs-search-results"]'
      );
      if (jobsList) return { error: 'no_job_selected' };
    }

    const companyLine = extractCompanyLine();
    const parsed = parseCompanyLine(companyLine);

    const jobData = {
      title: extractTitle(),
      company: parsed.company || '',
      location: parsed.location || '',
      workType: extractWorkType(parsed),
      employmentType: extractEmploymentType(),
      salary: extractSalary(),
      postedDate: extractPostedDate(),
      applicants: extractApplicants(),
      description: extractDescription(),
      skills: [],
      benefits: [],
      companyDescription: '',
      url: extractJobUrl(),
      extractedAt: new Date().toISOString()
    };

    if (!jobData.title && !jobData.company) {
      await new Promise(r => setTimeout(r, 800));
      jobData.title = extractTitle();
      const cl2 = extractCompanyLine();
      const p2 = parseCompanyLine(cl2);
      jobData.company = p2.company;
      if (!jobData.title && !jobData.company) {
        return { error: 'incomplete_data', partial: jobData };
      }
    }

    return { success: true, data: jobData };
  }

  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractJobData') {
      extractJobData().then(result => {
        sendResponse(result);
      }).catch(err => {
        console.error('Extraction error:', err);
        sendResponse({ error: 'extraction_failed', message: err.message });
      });
      return true;
    }
  });

  // Debug helpers accessible from the browser console
  window.__linkedinJDExtractor = {
    extract: extractJobData,
    debug: {
      getContainer: getJobContainer,
      getCompanyLine: extractCompanyLine,
      parseCompanyLine,
      findTitle: extractTitle,
      findDescription: extractDescription,
      findDate: extractPostedDate,
    }
  };

  console.log('LinkedIn JD Extractor loaded. Debug: window.__linkedinJDExtractor.debug');

})();
