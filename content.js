/**
 * LinkedIn Job Description Extractor
 * Content script that extracts job information from LinkedIn and BuiltIn job pages
 */

(function() {
  'use strict';

  // Selectors for job details on LinkedIn (updated for 2025/2026 LinkedIn structure)
  const SELECTORS = {
    // Job detail panel (right side when viewing a job)
    jobDetailContainer: [
      '.jobs-search__job-details',
      '.jobs-details',
      '.job-view-layout.jobs-details',
      '.job-details-jobs-unified-top-card__container--two-pane',
      '.scaffold-layout__detail',
      '.jobs-search-two-pane__detail',
      '.jobs-search-two-pane__job-details',
      '[role="main"]',
      '#workspace'
    ],
    
    // Job title - more comprehensive selectors
    jobTitle: [
      '.job-details-jobs-unified-top-card__job-title h1',
      '.job-details-jobs-unified-top-card__job-title a',
      '.job-details-jobs-unified-top-card__job-title',
      '.t-24.t-bold',
      '.jobs-details-top-card__job-title',
      'h1',
      '[role="heading"][aria-level="1"]',
      // Fallback: find h1/h2 in job details area
      '.jobs-search__job-details h1',
      '.jobs-search__job-details h2'
    ],
    
    // Company name
    companyName: [
      '.job-details-jobs-unified-top-card__company-name a',
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name a',
      '.jobs-unified-top-card__company-name',
      'a[href*="/company/"]',
      'a[href*="/company/"][href*="/life/"]',
      '.jobs-details-top-card__company-url',
      '.topcard__org-name-link'
    ],
    
    // Location
    location: [
      '.job-details-jobs-unified-top-card__primary-description-container .tvm__text--low-emphasis',
      '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
      '.job-details-jobs-unified-top-card__primary-description-container span',
      '.jobs-unified-top-card__bullet',
      '.jobs-details-top-card__bullet',
      '.topcard__flavor--bullet'
    ],
    
    // Job description - expanded selectors
    description: [
      '[data-testid="expandable-text-box"]',
      '.jobs-description__content',
      '.jobs-description-content__text',
      '.jobs-box__html-content',
      '#job-details',
      '.description__text',
      // "About the job" section container
      '.jobs-description',
      'article[class*="jobs-description"]',
      // Fallback: look for article or section with job content
      '.jobs-search__job-details article'
    ],
    
    // Skills
    skills: [
      '.job-details-how-you-match__skills-item',
      '.jobs-unified-top-card__job-insight-text-button',
      '.job-details-skill-match-modal__skill-name',
      '[class*="skill-match"] span',
      '[class*="skills-item"]'
    ],
    
    // Company info
    companyDescription: [
      '.jobs-company__company-description',
      '.jobs-unified-description__company-description',
      '[class*="company-description"]'
    ]
  };

  let cachedJobDetailRoot = null;
  let cachedJobDetailHref = '';
  const JOB_CARD_WRAPPER_SELECTOR = '.scaffold-layout__list-item';
  const JOB_CARD_SELECTOR = '.job-card-container, .job-card-list, [class*="job-card-container"]';
  const PROMOTED_JOBS_MODES = new Set(['off', 'highlight', 'hide']);
  const defaultSettings = {
    autoCopy: false,
    autoSave: false,
    fileFormat: 'text',
    downloadFolder: '',
    promotedJobsMode: 'highlight'
  };
  let currentSettings = { ...defaultSettings };
  let jobCardObserver = null;
  let jobCardScanQueued = false;

  function queryMultipleIn(root, selectors) {
    if (!root) return null;
    if (typeof selectors === 'string') {
      return root.querySelector(selectors);
    }

    for (const selector of selectors) {
      try {
        const element = root.querySelector(selector);
        if (element) {
          return element;
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }
    return null;
  }

  function queryAllMultipleIn(root, selectors) {
    if (!root) return [];
    if (typeof selectors === 'string') {
      return root.querySelectorAll(selectors);
    }

    for (const selector of selectors) {
      try {
        const elements = root.querySelectorAll(selector);
        if (elements.length > 0) {
          return elements;
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }
    return [];
  }

  function getJobDetailRoot(forceRefresh = false) {
    if (
      !forceRefresh &&
      cachedJobDetailRoot &&
      cachedJobDetailHref === window.location.href &&
      document.contains(cachedJobDetailRoot)
    ) {
      return cachedJobDetailRoot;
    }

    cachedJobDetailRoot = queryMultipleIn(document, SELECTORS.jobDetailContainer);
    cachedJobDetailHref = window.location.href;
    return cachedJobDetailRoot || document;
  }

  /**
   * Query multiple selectors and return first match
   */
  function queryMultiple(selectors, root = null) {
    return queryMultipleIn(root || getJobDetailRoot(), selectors);
  }

  /**
   * Query all matching elements from multiple selectors
   */
  function queryAllMultiple(selectors, root = null) {
    return queryAllMultipleIn(root || getJobDetailRoot(), selectors);
  }

  /**
   * Clean text by removing extra whitespace
   */
  function cleanText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').trim();
  }

  function normalizePromotedJobsMode(value) {
    return PROMOTED_JOBS_MODES.has(value) ? value : defaultSettings.promotedJobsMode;
  }

  function getCardWrapper(card) {
    if (!card) return null;
    return card.closest(JOB_CARD_WRAPPER_SELECTOR) || card;
  }

  function getJobCards() {
    const wrappers = Array.from(document.querySelectorAll(JOB_CARD_WRAPPER_SELECTOR));
    return wrappers
      .map(wrapper => wrapper.querySelector(JOB_CARD_SELECTOR))
      .filter(Boolean)
      .filter(card => {
        const text = cleanText(card.textContent || '');
        return Boolean(text) && /\/jobs\/view\//.test(card.innerHTML);
      });
  }

  function getPromotedFooterText(card) {
    if (!card) return '';

    const footer = queryMultipleIn(card, [
      '.job-card-list__footer-wrapper',
      '.job-card-container__footer-wrapper',
      '[class*="footer-wrapper"]'
    ]);
    const footerText = cleanText((footer && (footer.innerText || footer.textContent)) || '');
    if (footerText) {
      return footerText;
    }

    const promotedNode = Array.from(card.querySelectorAll('li, span, div'))
      .find(node => cleanText(node.textContent || '') === 'Promoted');
    return cleanText((promotedNode && promotedNode.textContent) || '');
  }

  function isPromotedJobCard(card) {
    const footerText = getPromotedFooterText(card);
    if (/\bPromoted\b/i.test(footerText)) {
      return true;
    }

    const ariaText = cleanText(card.getAttribute('aria-label') || '');
    if (/\bPromoted\b/i.test(ariaText)) {
      return true;
    }

    return false;
  }

  function applyPromotedJobsMode(mode) {
    document.documentElement.classList.remove(
      'li-ext-promoted-mode-off',
      'li-ext-promoted-mode-highlight',
      'li-ext-promoted-mode-hide'
    );
    document.documentElement.classList.add(`li-ext-promoted-mode-${mode}`);
  }

  function classifyJobCards() {
    const mode = normalizePromotedJobsMode(currentSettings.promotedJobsMode);
    applyPromotedJobsMode(mode);

    const cards = getJobCards();
    for (const card of cards) {
      const wrapper = getCardWrapper(card);
      const isPromoted = isPromotedJobCard(card);

      card.classList.add('li-ext-job-card');
      card.classList.toggle('li-ext-job-card--promoted', isPromoted);
      card.classList.toggle('li-ext-job-card--organic', !isPromoted);
      card.dataset.liExtPromoted = isPromoted ? 'true' : 'false';

      if (wrapper) {
        wrapper.classList.toggle('li-ext-job-card-wrapper--promoted', isPromoted);
        wrapper.classList.toggle('li-ext-job-card-wrapper--organic', !isPromoted);
        wrapper.dataset.liExtPromoted = isPromoted ? 'true' : 'false';
      }
    }
  }

  function queueJobCardClassification() {
    if (jobCardScanQueued) return;
    jobCardScanQueued = true;

    window.requestAnimationFrame(() => {
      jobCardScanQueued = false;
      classifyJobCards();
    });
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['settings']);
      currentSettings = { ...defaultSettings, ...(result.settings || {}) };
      currentSettings.promotedJobsMode = normalizePromotedJobsMode(currentSettings.promotedJobsMode);
    } catch (error) {
      console.warn('Failed to load settings, using defaults.', error);
      currentSettings = { ...defaultSettings };
    }

    queueJobCardClassification();
  }

  function watchJobCards() {
    if (jobCardObserver) {
      return;
    }

    jobCardObserver = new MutationObserver((mutations) => {
      const shouldRefresh = mutations.some(mutation => {
        if (mutation.type !== 'childList') {
          return false;
        }
        return Array.from(mutation.addedNodes).some(node => {
          if (!(node instanceof Element)) {
            return false;
          }
          return node.matches?.(JOB_CARD_WRAPPER_SELECTOR) ||
            node.matches?.(JOB_CARD_SELECTOR) ||
            node.querySelector?.(JOB_CARD_SELECTOR);
        });
      });

      if (shouldRefresh) {
        queueJobCardClassification();
      }
    });

    jobCardObserver.observe(document.body, { childList: true, subtree: true });
  }

  function initPromotedJobsEnhancements() {
    if (!window.location.href.includes('/jobs/')) {
      return;
    }

    loadSettings();
    watchJobCards();

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes.settings) {
        return;
      }

      currentSettings = { ...defaultSettings, ...(changes.settings.newValue || {}) };
      currentSettings.promotedJobsMode = normalizePromotedJobsMode(currentSettings.promotedJobsMode);
      queueJobCardClassification();
    });

    window.addEventListener('popstate', queueJobCardClassification);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        queueJobCardClassification();
      }
    });
    queueJobCardClassification();
  }

  function extractApplicantsValue(text) {
    const cleaned = cleanText(text);
    if (!cleaned) return '';
    if (cleaned.length > 140) return '';
    if (/\b(?:be an early applicant|top applicant)\b/i.test(cleaned)) return '';

    const patterns = [
      /\b(?:over\s+)?\d[\d,]*(?:\+)?\s+applicants?\b/i,
      /\b(?:over\s+)?\d[\d,]*(?:\+)?\s+people clicked apply\b/i
    ];

    for (const pattern of patterns) {
      const match = cleaned.match(pattern);
      if (match) {
        return cleanText(match[0]);
      }
    }

    return '';
  }

  /**
   * Extract text content from element
   */
  function getTextContent(selectors) {
    const element = queryMultiple(selectors);
    return element ? cleanText(element.textContent) : '';
  }

  function getTopCardText(root) {
    const topCard = queryMultipleIn(root, [
      '.job-details-jobs-unified-top-card',
      '.jobs-unified-top-card',
      '.job-details-jobs-unified-top-card__container--two-pane',
      '[data-testid="lazy-column"]',
      '[role="main"]'
    ]);
    if (!topCard) return '';
    return cleanText(topCard.textContent || '');
  }

  function getMainText(root) {
    const main = queryMultipleIn(root || document, [
      '[role="main"]',
      '#workspace',
      '[data-testid="lazy-column"]',
      'main'
    ]);
    return cleanText((main && (main.innerText || main.textContent)) || '');
  }

  function parseTitleCompanyFromDocumentTitle() {
    const raw = cleanText(document.title || '');
    if (!raw) return { title: '', company: '' };

    const pieces = raw
      .split(/\s*\|\s*/)
      .map((part) => cleanText(part))
      .filter(Boolean)
      .filter((part) => part.toLowerCase() !== 'linkedin');

    if (pieces.length >= 2) {
      return {
        title: pieces[0] || '',
        company: pieces[1] || ''
      };
    }

    const fallbackMatch = raw.match(/^(.*?)\s*\|\s*(.*?)\s*\|\s*LinkedIn$/i);
    if (fallbackMatch) {
      return {
        title: cleanText(fallbackMatch[1] || ''),
        company: cleanText(fallbackMatch[2] || '')
      };
    }

    return { title: '', company: '' };
  }

  function extractTextSection(text, startAnchors, stopAnchors = []) {
    const source = cleanText(text || '');
    if (!source) return '';

    const lowerSource = source.toLowerCase();
    const startMatches = startAnchors
      .map(anchor => {
        const index = lowerSource.indexOf(anchor.toLowerCase());
        return index >= 0 ? { anchor, index } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.index - b.index);

    if (startMatches.length === 0) {
      return '';
    }

    const { anchor, index: startIndex } = startMatches[0];
    const searchStart = startIndex + anchor.length;
    const stopMatches = stopAnchors
      .map(stop => lowerSource.indexOf(stop.toLowerCase(), searchStart))
      .filter(index => index >= 0)
      .sort((a, b) => a - b);
    const endIndex = stopMatches.length > 0 ? stopMatches[0] : source.length;

    let section = source.slice(startIndex, endIndex).trim();
    section = section.replace(new RegExp(`^${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*[:\-—–]?\s*`, 'i'), '').trim();
    return section;
  }

  function extractDescriptionFromText(text) {
    const description = extractTextSection(text, [
      'about the job',
      'about this job',
      'job description',
      'what you’ll do',
      "what you'll do",
      'what we’re looking for',
      'what we are looking for'
    ], [
      'compensation',
      'benefits',
      'eeo statement',
      'equal opportunity',
      'why we care so much about belonging',
      'diversity',
      'privacy policy',
      'apply now',
      'additional information'
    ]);

    if (description) return description;

    return cleanText(text || '');
  }

  function isLikelyJobTitle(text) {
    const cleaned = cleanText(text || '');
    if (!cleaned) return false;

    const lower = cleaned.toLowerCase();
    const blockedExact = new Set([
      'full-time',
      'full time',
      'part-time',
      'part time',
      'contract',
      'internship',
      'temporary',
      'remote',
      'hybrid',
      'on-site',
      'onsite',
      'entry level',
      'associate',
      'mid-senior level',
      'director',
      'executive',
      'see all',
      'show all',
      'show more',
      'show less',
      'more',
      'less'
    ]);

    if (blockedExact.has(lower)) return false;
    if (/\b(full-time|full time|part-time|part time|contract|internship|temporary|remote|hybrid|on-site|onsite|entry level|associate|mid-senior level|director|executive)\b/i.test(lower) && cleaned.split(/\s+/).length <= 4) {
      return false;
    }

    if (cleaned.length < 3 || cleaned.length > 140) return false;
    if (/linkedin/i.test(cleaned)) return false;
    if (/^(see all|show all|show more|show less|more|less)$/i.test(cleaned)) return false;
    if (/^\$[\d,.]+(?:\s*[kKmM])?(?:\s*\/\s*[a-z]+)?(?:\s*-\s*\$[\d,.]+(?:\s*[kKmM])?(?:\s*\/\s*[a-z]+)?)?$/i.test(cleaned)) return false;
    if (/^\$[\d,.]+(?:\s*[kKmM])?\s*\/\s*(?:yr|year|hr|hour|mo|month)$/i.test(cleaned)) return false;
    if (/^(remote|hybrid|on-site|onsite|full-time|full time|part-time|part time|contract|internship|temporary|entry level|associate|mid-senior level|director|executive)$/i.test(cleaned)) return false;

    return true;
  }

  function extractTitleFromMeta(root) {
    const metaSelectors = [
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="title"]'
    ];

    for (const selector of metaSelectors) {
      const meta = document.querySelector(selector);
      const content = cleanText(meta?.getAttribute('content') || '');
      if (!content) continue;

      const parsed = parseTitleCompanyFromDocumentTitle();
      if (parsed.title && content.toLowerCase().includes(parsed.title.toLowerCase())) {
        return parsed.title;
      }

      const parts = content.split(/\s*\|\s*/).map(cleanText).filter(Boolean).filter(part => part.toLowerCase() !== 'linkedin');
      if (parts.length > 0 && isLikelyJobTitle(parts[0])) {
        return parts[0];
      }
    }

    return '';
  }

  function extractTitleFromVisibleText(root, preferredTitle = '') {
    const preferred = cleanText(preferredTitle || '');
    if (preferred) {
      const exactMatchSelectors = ['h1', 'h2', 'h3', 'p', 'div', 'span', 'a'];
      for (const selector of exactMatchSelectors) {
        const elements = root.querySelectorAll(selector);
        for (const el of elements) {
          const text = cleanText(el.textContent || '');
          if (text === preferred) {
            return text;
          }
        }
      }
    }

    const titleSelectors = [
      'h1',
      '[role="heading"][aria-level="1"]',
      'h2',
      '[role="heading"][aria-level="2"]'
    ];

    for (const selector of titleSelectors) {
      const elements = root.querySelectorAll(selector);
      for (const el of elements) {
        const text = cleanText(el.textContent || '');
        if (!isLikelyJobTitle(text)) continue;
        return text;
      }
    }

    return '';
  }

  function extractCompanyFromVisibleText(root) {
    const links = root.querySelectorAll('a[href*="/company/"]');
    for (const link of links) {
      const text = cleanText(link.textContent || '');
      if (!text) continue;
      if (text.toLowerCase().includes('followers')) continue;
      if (text.length > 2 && text.length < 100) return text;
    }

    const companyCandidates = root.querySelectorAll('[role="heading"], h2, h3, span, div');
    for (const el of companyCandidates) {
      const text = cleanText(el.textContent || '');
      if (!text || text.length > 100) continue;
      if (/linkedin/i.test(text)) continue;
      if (/followers?/i.test(text)) continue;
      if (/^[A-Z0-9&.,'’()\-\s]+$/.test(text) || /[a-z]/i.test(text)) {
        return text;
      }
    }

    return '';
  }

  function extractCompanyFromLinks(root) {
    const links = root.querySelectorAll('a[href*="/company/"]');
    for (const link of links) {
      const text = cleanText(link.textContent || '');
      if (!text) continue;
      if (text.toLowerCase().includes('followers')) continue;
      if (text.length > 2 && text.length < 100) return text;
    }
    return '';
  }

  function extractLocationFromText(text) {
    if (!text) return '';
    const patterns = [
      /([A-Za-z .'-]+,\s*[A-Z]{2})(?:\s*\((?:Remote|Hybrid|On-site|Onsite)\))?/,
      /([A-Za-z .'-]+,\s*[A-Za-z .'-]+)(?:\s*\((?:Remote|Hybrid|On-site|Onsite)\))?/
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) return cleanText(match[1]);
    }
    return '';
  }

  function extractLocationFromMetaLine(root) {
    const candidates = root.querySelectorAll('span, div, p, li');
    const agoPattern = /\d+\s*(day|week|month|hour|minute)s?\s*ago/i;
    const locationPattern = /^([A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){0,4},\s*[A-Z]{2})(?:\s*\((?:Remote|Hybrid|On-site|Onsite)\))?$/;

    for (const node of candidates) {
      const text = cleanText(node.textContent || '');
      if (!text || text.length > 180) continue;
      if (!text.includes('·') || !agoPattern.test(text)) continue;

      const head = cleanText(text.split('·')[0] || '');
      const match = head.match(locationPattern);
      if (match && match[1]) return cleanText(match[1]);
    }
    return '';
  }

  /**
   * Extract salary information from pill buttons/insights
   * Targets the strong element inside buttons that contains the salary range
   */
  function extractSalary() {
    const root = getJobDetailRoot();
    // Pattern to match salary ranges like "$118K/yr - $174K/yr" or "$255K/yr - $405K/yr"
    const salaryPattern = /\$\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:K)?(?:\s*\/\s*(?:yr|year|hr|hour))?\s*(?:-|–|—|to)\s*\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:K)?(?:\s*\/\s*(?:yr|year|hr|hour))?(?:\s*USD)?/i;
    
    // First, try to find the strong element directly (most specific)
    const strongElements = root.querySelectorAll('.job-details-jobs-unified-top-card__job-insight strong, .job-details-jobs-unified-top-card strong');
    for (const el of strongElements) {
      const text = el.textContent || '';
      const match = text.match(salaryPattern);
      if (match) {
        return cleanText(match[0]);
      }
    }
    
    // Fallback: look for buttons containing salary
    const buttons = root.querySelectorAll('.job-details-jobs-unified-top-card button, .job-details-jobs-unified-top-card__job-insight button');
    for (const el of buttons) {
      const text = el.textContent || '';
      const match = text.match(salaryPattern);
      if (match) {
        return cleanText(match[0]);
      }
    }

    const topCardText = getTopCardText(root);
    const topCardMatch = topCardText.match(salaryPattern);
    if (topCardMatch) {
      return cleanText(topCardMatch[0]);
    }

    const mainText = getMainText(root);
    const mainTextMatch = mainText.match(salaryPattern);
    if (mainTextMatch) {
      return cleanText(mainTextMatch[0]);
    }
    
    return '';
  }

  /**
   * Extract work type (Remote, Hybrid, On-site)
   */
  function extractWorkType() {
    const root = getJobDetailRoot();
    const searchText = (text) => {
      const lower = (text || '').toLowerCase();
      if (lower.includes('remote')) return 'Remote';
      if (lower.includes('hybrid')) return 'Hybrid';
      if (lower.includes('on-site') || lower.includes('onsite')) return 'On-site';
      return '';
    };

    // Look in pill buttons first
    const pillSelectors = [
      '.job-details-jobs-unified-top-card__job-insight',
      '.job-details-jobs-unified-top-card__job-insight-view-model-secondary',
      '.job-details-jobs-unified-top-card__primary-description-container',
      '.ui-label'
    ];
    
    for (const selector of pillSelectors) {
      try {
        const elements = root.querySelectorAll(selector);
        for (const el of elements) {
          const match = searchText(el.textContent || '');
          if (match) return match;
        }
      } catch (e) {}
    }
    
    // Check in the primary description area
    const descContainers = root.querySelectorAll('.job-details-jobs-unified-top-card__primary-description-container, .job-details-jobs-unified-top-card__job-insight');
    for (const container of descContainers) {
      const match = searchText(container.textContent || '');
      if (match) return match;
    }

    const topCardMatch = searchText(getTopCardText(root));
    if (topCardMatch) return topCardMatch;

    const mainTextMatch = searchText(getMainText(root));
    if (mainTextMatch) return mainTextMatch;
    
    return '';
  }

  /**
   * Extract employment type (Full-time, Part-time, Contract, etc.)
   */
  function extractEmploymentType() {
    const root = getJobDetailRoot();
    const searchText = (text) => {
      const lower = (text || '').toLowerCase();
      if (lower.includes('full-time') || lower.includes('full time')) return 'Full-time';
      if (lower.includes('part-time') || lower.includes('part time')) return 'Part-time';
      if (lower.includes('contract')) return 'Contract';
      if (lower.includes('internship')) return 'Internship';
      if (lower.includes('temporary')) return 'Temporary';
      return '';
    };

    const pillSelectors = [
      '.job-details-jobs-unified-top-card__job-insight',
      '.job-details-jobs-unified-top-card__job-insight-view-model-secondary',
      '.job-details-jobs-unified-top-card__primary-description-container',
      '.ui-label',
      '.job-details-jobs-unified-top-card button'
    ];
    
    for (const selector of pillSelectors) {
      try {
        const elements = root.querySelectorAll(selector);
        for (const el of elements) {
          const match = searchText(el.textContent || '');
          if (match) return match;
        }
      } catch (e) {}
    }

    const topCardMatch = searchText(getTopCardText(root));
    if (topCardMatch) return topCardMatch;

    const mainTextMatch = searchText(getMainText(root));
    if (mainTextMatch) return mainTextMatch;
    
    return '';
  }

  /**
   * Extract posted date
   */
  function extractPostedDate() {
    const root = getJobDetailRoot();
    const selectors = [
      '.job-details-jobs-unified-top-card__primary-description-container .tvm__text--neutral',
      '.jobs-unified-top-card__posted-date',
      '.posted-time-ago__text',
      '[class*="posted"]',
      'span[class*="posted"]'
    ];
    
    for (const selector of selectors) {
      try {
        const elements = root.querySelectorAll(selector);
        for (const el of elements) {
          const text = el.textContent || '';
          // Look for time patterns like "1 week ago", "Reposted 2 days ago", etc.
          if (text.match(/\d+\s*(day|week|month|hour|minute)s?\s*ago/i) ||
              text.match(/posted|reposted/i)) {
            return cleanText(text);
          }
        }
      } catch (e) {}
    }
    
    // Search in the primary description
    const primaryDesc = root.querySelector('.job-details-jobs-unified-top-card__primary-description-container');
    if (primaryDesc) {
      const text = primaryDesc.textContent || '';
      const match = text.match(/(?:posted|reposted)?\s*\d+\s*(?:day|week|month|hour|minute)s?\s*ago/i);
      if (match) {
        return cleanText(match[0]);
      }
    }

    const mainText = getMainText(root);
    const genericMatch = mainText.match(/(?:posted on [a-z]+\s+\d{1,2},\s+\d{4}(?:,\s+\d{1,2}:\d{2}\s*[ap]m)?|\d+\s*(?:day|week|month|hour|minute)s?\s*ago)/i);
    if (genericMatch) return cleanText(genericMatch[0]);

    const fallbackMatch = mainText.match(/(?:posted|reposted)\s+\d+\s*(?:day|week|month|hour|minute)s?\s*ago/i);
    if (fallbackMatch) return cleanText(fallbackMatch[0]);
    
    return '';
  }

  /**
   * Extract number of applicants
   */
  function extractApplicants() {
    const root = getJobDetailRoot();
    const selectors = [
      '.jobs-unified-top-card__applicant-count',
      '.num-applicants__caption',
      '[class*="applicant-count"]',
      '[class*="num-applicants"]',
      '.job-details-jobs-unified-top-card__primary-description-container .tvm__text--low-emphasis',
      '.job-details-jobs-unified-top-card__tertiary-description-container .tvm__text--low-emphasis',
      '.job-details-jobs-unified-top-card__primary-description-container',
      '.job-details-jobs-unified-top-card__tertiary-description-container'
    ];
    
    for (const selector of selectors) {
      try {
        const elements = root.querySelectorAll(selector);
        for (const el of elements) {
          const match = extractApplicantsValue(el.textContent || '');
          if (match) {
            return match;
          }
        }
      } catch (e) {}
    }
    
    // Fallback: only inspect short leaf-ish text nodes to avoid scraping the whole page.
    const allElements = root.querySelectorAll('span, p, li, div');
    for (const el of allElements) {
      const childCount = el.children ? el.children.length : 0;
      if (childCount > 2) continue;

      const match = extractApplicantsValue(el.textContent || '');
      if (match) {
        return match;
      }
    }

    const mainText = getMainText(root);
    const mainTextMatch = extractApplicantsValue(mainText);
    if (mainTextMatch) {
      return mainTextMatch;
    }
    
    return '';
  }

  /**
   * Extract job description text with multiple fallback strategies
   */
  function extractDescription() {
    const root = getJobDetailRoot();
    // Strategy 1: Standard selectors
    let descEl = queryMultiple(SELECTORS.description, root);

    // Strategy 2: Look for obvious description headings in the visible content
    if (!descEl) {
      const headingSelectors = 'h1, h2, h3, h4, h5, h6, strong, [role="heading"], [class*="heading"]';
      const headings = root.querySelectorAll(headingSelectors);
      for (const heading of headings) {
        const headingText = cleanText(heading.textContent || '').toLowerCase();
        if (
          headingText.includes('about the job') ||
          headingText.includes('about this job') ||
          headingText.includes('job description') ||
          headingText.includes('what you’ll do') ||
          headingText.includes("what you'll do") ||
          headingText.includes('what we’re looking for') ||
          headingText.includes('what we are looking for')
        ) {
          const sibling = heading.nextElementSibling;
          if (sibling) {
            descEl = sibling;
            break;
          }
          const parent = heading.parentElement;
          if (parent) {
            descEl = parent;
            break;
          }
        }
      }
    }
    
    // Strategy 3: Look for the main article/section with job content
    if (!descEl) {
      const articles = root.querySelectorAll('article, [role="article"], section');
      for (const article of articles) {
        const text = article.textContent || '';
        // Check if it has substantial content and job-related keywords
        if (text.length > 500 && 
            (text.includes('responsibilities') || 
             text.includes('qualifications') || 
             text.includes('requirements') ||
             text.includes('experience'))) {
          descEl = article;
          break;
        }
      }
    }
    
    // Strategy 4: Find the largest text block in the job details area
    if (!descEl) {
      const jobDetailsArea = root;
      if (jobDetailsArea) {
        const textBlocks = jobDetailsArea.querySelectorAll('div, section, article');
        let largestBlock = null;
        let maxLength = 0;
        
        for (const block of textBlocks) {
          const directText = block.innerText || block.textContent || '';
          if (directText.length > maxLength && directText.length > 200) {
            maxLength = directText.length;
            largestBlock = block;
          }
        }
        
        if (largestBlock) {
          descEl = largestBlock;
        }
      }
    }
    
    const rawText = descEl ? (descEl.innerText || descEl.textContent || '') : getMainText(root);
    if (!rawText) return '';

    // Clean up the text while preserving line breaks
    let text = rawText
      .replace(/[ \t]+/g, ' ')     // Collapse spaces/tabs
      .replace(/\n{3,}/g, '\n\n')  // Max 2 newlines
      .trim();

    const sliced = extractDescriptionFromText(text);
    const cleanedSliced = sliced.replace(/^(about the job|about this job|job description|description)\s*[:\-—–]?\s*/i, '').trim();

    // If the anchored slice is suspiciously small, prefer the larger text block.
    if (cleanedSliced.length >= 250 || text.length < 500) {
      return cleanedSliced;
    }

    // Fall back to the cleaned text if we couldn't anchor the section well enough.
    return text.replace(/^(about the job|about this job|job description|description)\s*[:\-—–]?\s*/i, '').trim();
  }

  /**
   * Extract skills from the job page
   */
  function extractSkills() {
    const root = getJobDetailRoot();
    const skills = [];
    
    // Try various skill selectors
    const skillElements = queryAllMultiple(SELECTORS.skills, root);
    for (const el of skillElements) {
      const skill = cleanText(el.textContent);
      if (skill && !skills.includes(skill) && skill.length < 50) {
        skills.push(skill);
      }
    }
    
    // Also look for skills in the "Skills" section
    const skillsSections = root.querySelectorAll('[class*="skill-match"] span, [class*="skills-item"]');
    for (const el of skillsSections) {
      const skill = cleanText(el.textContent);
      if (skill && !skills.includes(skill) && skill.length < 50) {
        skills.push(skill);
      }
    }
    
    return skills;
  }

  /**
   * Extract benefits
   */
  function extractBenefits() {
    const root = getJobDetailRoot();
    const benefits = [];
    
    // Look in job insight containers
    const insightSelectors = [
      '.job-details-jobs-unified-top-card__job-insight',
      '[class*="job-insight"]',
      '[class*="benefit"]',
      'li[class*="insight"]'
    ];
    
    for (const selector of insightSelectors) {
      try {
        const elements = root.querySelectorAll(selector);
        for (const el of elements) {
          const text = cleanText(el.textContent);
          // Check for benefit-related keywords
          if (text.match(/401\(k\)|benefit|health|dental|vision|insurance|pto|vacation|equity|stock/i)) {
            if (!benefits.includes(text) && text.length < 100) {
              benefits.push(text);
            }
          }
        }
      } catch (e) {}
    }
    
    return benefits;
  }

  /**
   * Extract the job URL from the current page
   */
  function extractJobUrl() {
    const url = window.location.href;
    
    // Extract the currentJobId from URL if present
    const jobIdMatch = url.match(/currentJobId=(\d+)/) || url.match(/\/jobs\/view\/(\d+)/);
    if (jobIdMatch) {
      return `https://www.linkedin.com/jobs/view/${jobIdMatch[1]}`;
    }
    
    return url;
  }

  /**
   * Wait for the job details to load (helps with dynamic content)
   */
  function waitForJobDetails(timeout = 3000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const check = () => {
        const detailRoot = getJobDetailRoot(true);
        // Check if job details are loaded
        const hasTitle = queryMultipleIn(detailRoot, SELECTORS.jobTitle);
        const hasDescription = queryMultipleIn(detailRoot, SELECTORS.description);
        
        if (detailRoot !== document || hasTitle || hasDescription) {
          resolve(true);
          return;
        }
        
        // Check timeout
        if (Date.now() - startTime > timeout) {
          resolve(false);
          return;
        }
        
        // Check again
        setTimeout(check, 200);
      };
      
      check();
    });
  }

  /**
   * BuiltIn.com specific extraction
   */
  async function extractBuiltInJobData() {
    const jobPosting = extractJsonLd();
    const initData = extractBuiltinInitData();
    
    const jobData = {
      title: '',
      company: '',
      location: '',
      workType: '',
      employmentType: '',
      salary: '',
      postedDate: '',
      applicants: '',
      description: '',
      skills: [],
      benefits: [],
      companyDescription: '',
      url: window.location.href,
      extractedAt: new Date().toISOString()
    };

    if (initData && initData.job) {
      jobData.title = initData.job.title || '';
      jobData.company = initData.job.companyName || '';
    }

    if (jobPosting) {
      if (!jobData.title) jobData.title = jobPosting.title || '';
      if (!jobData.company) jobData.company = jobPosting.hiringOrganization?.name || '';
      
      if (jobPosting.jobLocation?.address) {
        const addr = jobPosting.jobLocation.address;
        jobData.location = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
          .filter(Boolean).join(', ');
      }
      jobData.employmentType = jobPosting.employmentType || '';
      jobData.postedDate = jobPosting.datePosted || '';
      jobData.description = cleanBuiltInDescription(jobPosting.description || '');
      
      if (jobPosting.baseSalary?.value) {
        const val = jobPosting.baseSalary.value;
        if (val.minValue && val.maxValue) {
          jobData.salary = `$${val.minValue.toLocaleString()} - $${val.maxValue.toLocaleString()}`;
          if (val.unitText) jobData.salary += ` per ${val.unitText.toLowerCase()}`;
        }
      }
      
      if (typeof jobPosting.jobBenefits === 'string') {
        jobData.benefits = jobPosting.jobBenefits.split(',').map(b => b.trim());
      } else if (Array.isArray(jobPosting.jobBenefits)) {
        jobData.benefits = jobPosting.jobBenefits;
      }

      if (jobPosting.industry) {
        jobData.skills = Array.isArray(jobPosting.industry) ? jobPosting.industry : [jobPosting.industry];
      }
    }

    // Fallback to DOM if JSON-LD/Init missed something
    if (!jobData.title) jobData.title = getTextContent('h1.fw-extrabold') || getTextContent('.job-header h1');
    if (!jobData.company) jobData.company = getTextContent('a[href*="/company/"] span.fw-medium') || getTextContent('.company-name');
    
    if (!jobData.description) {
      const descEl = document.querySelector('.job-description') || document.querySelector('.description') || document.querySelector('[class*="job-description"]');
      if (descEl) jobData.description = descEl.innerText.trim();
    }

    if (!jobData.location) {
      jobData.location = getTextContent('.attribute-section .font-barlow.text-gray-03');
    }
    
    // BuiltIn often has a "What We Do" or "Why Work With Us" section
    if (!jobData.companyDescription) {
      const headings = Array.from(document.querySelectorAll('h2, h3'));
      const whatWeDo = headings.find(h => h.textContent.includes('What We Do'));
      if (whatWeDo && whatWeDo.nextElementSibling) {
        jobData.companyDescription = whatWeDo.nextElementSibling.innerText.trim();
      }
    }

    return { success: true, data: jobData };
  }

  function cleanBuiltInDescription(html) {
    if (!html) return '';
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return temp.innerText.trim();
  }

  function extractJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        const items = Array.isArray(data) ? data : (data['@graph'] || [data]);
        const jobPosting = items.find(item => item['@type'] === 'JobPosting');
        if (jobPosting) return jobPosting;
      } catch (e) {}
    }
    return null;
  }

  function extractBuiltinInitData() {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const match = script.textContent.match(/Builtin\.jobPostInit\((\{.*?\})\);/s);
      if (match) {
        try {
          return JSON.parse(match[1]);
        } catch (e) {}
      }
    }
    return null;
  }

  /**
   * Main extraction function
   */
  async function extractJobData() {
    const url = window.location.href;
    const isLinkedIn = url.includes('linkedin.com');
    const isBuiltIn = url.includes('builtin.com');

    if (isBuiltIn) {
      return await extractBuiltInJobData();
    }

    if (!isLinkedIn) {
      return { error: 'not_supported_site' };
    }

    // Check if we're on a job page
    const isJobPage = url.includes('/jobs/') || url.includes('linkedin.com/jobs');
    if (!isJobPage) {
      return { error: 'not_linkedin_jobs' };
    }

    // Wait for content to load — search-results page needs more time for the right panel
    const isSearchResults = window.location.href.includes('search-results') || window.location.href.includes('currentJobId=');
    await waitForJobDetails(isSearchResults ? 5000 : 3000);

    // Check for job detail panel
    const jobDetail = queryMultipleIn(document, SELECTORS.jobDetailContainer);
    if (!jobDetail) {
      // Try to detect if we're on a jobs list page without a selected job
      // But if currentJobId is in the URL, a job IS selected — don't bail out
      const hasCurrentJobId = window.location.href.includes('currentJobId=');
      const jobsList = document.querySelector('.jobs-search-results-list, .scaffold-layout__list, [class*="jobs-search-results"]');
      if (jobsList && !hasCurrentJobId) {
        return { error: 'no_job_selected' };
      }
      if (!hasCurrentJobId) {
        return { error: 'no_job_data' };
      }
      // currentJobId present but container not found yet — content may still be loading
    }

    // Extract all job data
    const jobData = {
      title: getTextContent(SELECTORS.jobTitle),
      company: getTextContent(SELECTORS.companyName),
      location: getTextContent(SELECTORS.location),
      workType: extractWorkType(),
      employmentType: extractEmploymentType(),
      salary: extractSalary(),
      postedDate: extractPostedDate(),
      applicants: extractApplicants(),
      description: extractDescription(),
      skills: extractSkills(),
      benefits: extractBenefits(),
      companyDescription: getTextContent(SELECTORS.companyDescription),
      url: extractJobUrl(),
      extractedAt: new Date().toISOString()
    };

    // Fallbacks for LinkedIn's newer jobs UI with obfuscated classes.
    const detailRoot = getJobDetailRoot();
    const titleCompanyFromDocTitle = parseTitleCompanyFromDocumentTitle();
    if (!jobData.title) {
      jobData.title =
        extractTitleFromVisibleText(detailRoot, titleCompanyFromDocTitle.title) ||
        titleCompanyFromDocTitle.title ||
        extractTitleFromMeta(detailRoot) ||
        extractTitleFromVisibleText(detailRoot) ||
        '';
    }

    if (!isLikelyJobTitle(jobData.title)) {
      jobData.title =
        extractTitleFromVisibleText(detailRoot, titleCompanyFromDocTitle.title) ||
        titleCompanyFromDocTitle.title ||
        extractTitleFromMeta(detailRoot) ||
        extractTitleFromVisibleText(detailRoot) ||
        '';
    }
    if (!jobData.company) {
      jobData.company =
        extractCompanyFromVisibleText(detailRoot) ||
        extractCompanyFromLinks(detailRoot) ||
        titleCompanyFromDocTitle.company ||
        '';
    }
    if (!jobData.location) {
      jobData.location = extractLocationFromMetaLine(detailRoot) || extractLocationFromText(getMainText(detailRoot));
    }

    // Validate that we have at least a title or company
    if (!jobData.title && !jobData.company) {
      // Try one more time with a slight delay
      await new Promise(r => setTimeout(r, 500));
      jobData.title = getTextContent(SELECTORS.jobTitle);
      jobData.company = getTextContent(SELECTORS.companyName);
      
      if (!jobData.title && !jobData.company) {
        return { error: 'incomplete_data', partial: jobData };
      }
    }

    return { success: true, data: jobData };
  }

  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractJobData') {
      // Use async extraction with promise handling
      extractJobData().then(result => {
        sendResponse(result);
      }).catch(err => {
        console.error('Extraction error:', err);
        sendResponse({ error: 'extraction_failed', message: err.message });
      });
      return true; // Keep the message channel open for async response
    }
  });

  // Also expose for debugging in console
  window.__linkedinJDExtractor = {
    extract: extractJobData,
    selectors: SELECTORS,
    // Debug helpers
    debug: {
      findSalary: extractSalary,
      findDescription: extractDescription,
      findTitle: () => getTextContent(SELECTORS.jobTitle),
      findCompany: () => getTextContent(SELECTORS.companyName),
      testSelectors: () => {
        console.log('Testing selectors...');
        for (const [name, sels] of Object.entries(SELECTORS)) {
          const root = name === 'jobDetailContainer' ? document : getJobDetailRoot();
          const found = queryMultipleIn(root, sels);
          console.log(`${name}: ${found ? '✓ Found' : '✗ Not found'}`);
        }
      }
    }
  };

  console.log('LinkedIn JD Extractor loaded. Debug with: window.__linkedinJDExtractor.debug.testSelectors()');
  initPromotedJobsEnhancements();

})();
