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
  const PARSER_STRATEGIES = new Set(['robust', 'legacy']);
  const defaultSettings = {
    autoCopy: false,
    autoSave: false,
    fileFormat: 'text',
    downloadFolder: '',
    promotedJobsMode: 'highlight',
    parserStrategy: 'robust'
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

  function getResultListPenalty(text) {
    let penalty = 0;
    if (/jobs based on your preferences/i.test(text)) penalty += 80;
    if (/how promoted jobs are ranked/i.test(text)) penalty += 70;
    if (/are these results helpful/i.test(text)) penalty += 60;
    if (/\b\d+\+?\s+results\b/i.test(text)) penalty += 45;
    if ((text.match(/\bPosted\s+\d+\s+(?:hour|day|week|month)s?\s+ago\b/gi) || []).length >= 4) penalty += 50;
    return penalty;
  }

  function findSemanticJobDetailRoot() {
    const titleCompany = parseTitleCompanyFromDocumentTitle();
    const title = cleanText(titleCompany.title || '');
    const company = cleanText(titleCompany.company || '');
    const selectors = [
      '[data-testid="lazy-column"]',
      '[data-testid="lazy-column"] > div',
      'main section',
      'main article',
      'main > div',
      'main div',
      '[role="main"] div'
    ];
    const candidates = [];
    const seen = new Set();

    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (e) {
        continue;
      }

      for (const node of nodes) {
        if (!node || seen.has(node)) continue;
        seen.add(node);

        const text = cleanText(node.innerText || node.textContent || '');
        if (text.length < 120 || text.length > 60000) continue;

        const hasAbout = /\b(?:about the job|about this job|job description)\b/i.test(text);
        const hasTitle = title && text.includes(title);
        const hasCompany = company && text.includes(company);
        const hasApplyAction = /\bApply\b/i.test(text) && /\bSave\b/i.test(text);

        if (!hasAbout && !hasTitle && !hasCompany) continue;

        const resultPenalty = getResultListPenalty(text);
        let score = 0;
        if (hasAbout) score += 100;
        if (hasTitle) score += 35;
        if (hasCompany) score += 20;
        if (hasApplyAction) score += 15;
        if (node.getAttribute('data-testid') === 'lazy-column') score += 10;
        if (text.length >= 700 && text.length <= 30000) score += 10;
        score -= resultPenalty;

        candidates.push({ node, score, length: text.length, hasAbout, resultPenalty });
      }
    }

    candidates.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.hasAbout !== b.hasAbout) return a.hasAbout ? -1 : 1;
      return a.length - b.length;
    });

    const best = candidates[0];
    return best && best.score > 0 ? best.node : null;
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

    cachedJobDetailRoot = findSemanticJobDetailRoot() || queryMultipleIn(document, SELECTORS.jobDetailContainer);
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

  function normalizeParserStrategy(value) {
    return PARSER_STRATEGIES.has(value) ? value : defaultSettings.parserStrategy;
  }

  function normalizeSettings(settings = {}) {
    const normalized = { ...defaultSettings, ...settings };
    normalized.promotedJobsMode = normalizePromotedJobsMode(normalized.promotedJobsMode);
    normalized.parserStrategy = normalizeParserStrategy(normalized.parserStrategy);
    return normalized;
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
      currentSettings = normalizeSettings(result.settings || {});
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

      currentSettings = normalizeSettings(changes.settings.newValue || {});
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

  function getMainDescriptionText(root) {
    const main = queryMultipleIn(root || document, [
      '[role="main"]',
      '#workspace',
      '[data-testid="lazy-column"]',
      'main'
    ]);
    return normalizeSerializedDescription((main && (main.innerText || main.textContent)) || '');
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
    const source = text || '';
    if (!source.trim()) return '';

    const normalizedSource = source.replace(/[ \t]+/g, ' ');
    const lowerSource = normalizedSource.toLowerCase();
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
    const endIndex = stopMatches.length > 0 ? stopMatches[0] : normalizedSource.length;

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
      'additional information',
      'set alert for similar jobs',
      'job search faster with premium',
      'about the company',
      'more jobs',
      'similar jobs'
    ]);

    if (description) return description;

    return (text || '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function normalizeSerializedDescription(text) {
    return (text || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function isHiddenElement(el) {
    if (!el || !(el instanceof Element)) return false;
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;

    const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    return Boolean(style && (style.display === 'none' || style.visibility === 'hidden'));
  }

  function serializeDescriptionNode(node, listDepth = 0) {
    if (!node) return '';

    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent || '').replace(/\s+/g, ' ');
    }

    if (node.nodeType !== Node.ELEMENT_NODE || isHiddenElement(node)) {
      return '';
    }

    const el = node;
    const tag = el.tagName.toLowerCase();

    if (tag === 'br') {
      return '\n';
    }

    if (tag === 'li') {
      const text = Array.from(el.childNodes)
        .map(child => serializeDescriptionNode(child, listDepth + 1))
        .join('')
        .replace(/\s*\n\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return text ? `${'  '.repeat(Math.max(0, listDepth - 1))}- ${text}\n` : '';
    }

    const childText = Array.from(el.childNodes)
      .map(child => serializeDescriptionNode(child, tag === 'ul' || tag === 'ol' ? listDepth + 1 : listDepth))
      .join('');

    if (tag === 'ul' || tag === 'ol') {
      return `\n${childText}\n`;
    }

    if (/^(p|div|section|article|h[1-6])$/.test(tag)) {
      const text = childText.trim();
      return text ? `\n${text}\n` : '';
    }

    return childText;
  }

  function getDescriptionElementText(el) {
    if (!el) return '';

    const serialized = normalizeSerializedDescription(serializeDescriptionNode(el));
    if (serialized) {
      return serialized;
    }

    return normalizeSerializedDescription(el.innerText || el.textContent || '');
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

  function stripKnownJobHeaderText(text, values) {
    let cleaned = text || '';
    for (const value of values) {
      const token = cleanText(value || '');
      if (!token) continue;
      cleaned = cleaned.split(token).join(' ');
    }
    return cleanText(cleaned);
  }

  function cleanLocationCandidate(location, knownValues) {
    const cleaned = cleanText(location || '');
    if (!cleaned) return '';

    const stripped = stripKnownJobHeaderText(cleaned, knownValues);
    if (stripped && stripped !== cleaned) {
      return extractLocationFromText(stripped) || stripped;
    }

    return cleaned;
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

  function extractLocationFromSemanticNodes(root) {
    const candidates = root.querySelectorAll('span, div, p, li');
    const locationExactPattern = /^([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4},\s*[A-Z]{2})(?:\s*\((?:Remote|Hybrid|On-site|Onsite)\))?$/;
    const locationFragmentPattern = /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4},\s*[A-Z]{2})(?:\s*\((?:Remote|Hybrid|On-site|Onsite)\))?\b/;

    for (const node of candidates) {
      if (node.children && node.children.length > 1) continue;
      const text = cleanText(node.textContent || '');
      if (!text || text.length > 120) continue;

      const exact = text.match(locationExactPattern);
      if (exact && exact[1]) return cleanText(exact[1]);
    }

    for (const node of candidates) {
      if (node.children && node.children.length > 1) continue;
      const text = cleanText(node.textContent || '');
      if (!text || text.length > 180 || !text.includes('·')) continue;

      const fragments = text.split('·').map(cleanText).filter(Boolean);
      for (const fragment of fragments) {
        const exact = fragment.match(locationExactPattern);
        if (exact && exact[1]) return cleanText(exact[1]);
      }
    }

    for (const node of candidates) {
      if (node.children && node.children.length > 1) continue;
      const text = cleanText(node.textContent || '');
      if (!text || text.length > 80) continue;

      const match = text.match(locationFragmentPattern);
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
    
    const rawText = descEl ? getDescriptionElementText(descEl) : getMainText(root);
    if (!rawText) return '';

    // Clean up the text while preserving line breaks
    let text = normalizeSerializedDescription(rawText);

    const sliced = extractDescriptionFromText(text);
    const cleanedSliced = sliced.replace(/^(about the job|about this job|job description|description)\s*[:\-—–]?\s*/i, '').trim();
    const mainText = getMainDescriptionText(root);
    const mainSliced = extractDescriptionFromText(mainText);
    const cleanedMainSliced = mainSliced.replace(/^(about the job|about this job|job description|description)\s*[:\-—–]?\s*/i, '').trim();

    if (
      cleanedMainSliced.length > cleanedSliced.length + 250 &&
      /(?:about|what|who|responsibilities|requirements|qualifications)/i.test(cleanedMainSliced)
    ) {
      return cleanedMainSliced;
    }

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

  function createEmptyJobData() {
    return {
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
      url: extractJobUrl(),
      extractedAt: new Date().toISOString()
    };
  }

  function isMissingField(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  function mergeUnique(values) {
    const out = [];
    for (const value of values.flat()) {
      const cleaned = cleanText(value || '');
      if (cleaned && !out.includes(cleaned)) {
        out.push(cleaned);
      }
    }
    return out;
  }

  function fillMissingJobData(target, ...sources) {
    const scalarFields = [
      'title',
      'company',
      'location',
      'workType',
      'employmentType',
      'salary',
      'postedDate',
      'applicants',
      'description',
      'companyDescription',
      'url'
    ];

    for (const source of sources) {
      if (!source) continue;

      for (const field of scalarFields) {
        if (isMissingField(target[field]) && !isMissingField(source[field])) {
          target[field] = typeof source[field] === 'string' ? source[field].trim() : source[field];
        }
      }

      if (Array.isArray(source.skills)) {
        target.skills = mergeUnique([target.skills || [], source.skills]);
      }
      if (Array.isArray(source.benefits)) {
        target.benefits = mergeUnique([target.benefits || [], source.benefits]);
      }
    }

    return target;
  }

  function extractJobPostingLocation(jobPosting) {
    const locations = Array.isArray(jobPosting?.jobLocation)
      ? jobPosting.jobLocation
      : [jobPosting?.jobLocation].filter(Boolean);

    for (const location of locations) {
      const addr = location?.address || location;
      const value = [
        addr?.addressLocality,
        addr?.addressRegion,
        addr?.addressCountry
      ].filter(Boolean).join(', ');
      if (value) return value;
    }

    return '';
  }

  function extractSalaryFromJobPosting(jobPosting) {
    const value = jobPosting?.baseSalary?.value;
    if (!value) return '';

    if (typeof value === 'string') {
      return cleanText(value);
    }

    if (value.minValue && value.maxValue) {
      let salary = `$${Number(value.minValue).toLocaleString()} - $${Number(value.maxValue).toLocaleString()}`;
      if (value.unitText) {
        salary += ` per ${String(value.unitText).toLowerCase()}`;
      }
      return salary;
    }

    if (value.value) {
      let salary = `$${Number(value.value).toLocaleString()}`;
      if (value.unitText) {
        salary += ` per ${String(value.unitText).toLowerCase()}`;
      }
      return salary;
    }

    return '';
  }

  function extractMetaContent(selectors) {
    for (const selector of selectors) {
      const meta = document.querySelector(selector);
      const content = cleanText(meta?.getAttribute('content') || '');
      if (content) return content;
    }
    return '';
  }

  function extractCanonicalUrl() {
    const canonical = document.querySelector('link[rel="canonical"]');
    return cleanText(canonical?.getAttribute('href') || '');
  }

  function extractBuiltInLocationFromText(text) {
    const cleaned = cleanText(text || '');
    if (!cleaned) return '';

    const locationMatch = cleaned.match(/\b(?:Remote|Hybrid|In-Office|On-Site|Onsite|Remote or Hybrid)(?:\s+in)?\s+([A-Z][A-Za-z .'-]+,\s+[A-Z]{2}(?:,\s+USA)?|United States|USA|[A-Z][A-Za-z .'-]+,\s+[A-Za-z .'-]+,\s+USA)\b/i);
    if (locationMatch) {
      return cleanText(locationMatch[0]);
    }

    const cityStateMatch = cleaned.match(/\b[A-Z][A-Za-z .'-]+,\s+[A-Z]{2},\s+USA\b/);
    return cityStateMatch ? cleanText(cityStateMatch[0]) : '';
  }

  function extractBuiltInWorkTypeFromText(text) {
    const match = cleanText(text || '').match(/\b(Remote or Hybrid|Remote|Hybrid|In-Office|On-Site|Onsite)\b/i);
    return match ? cleanText(match[1]) : '';
  }

  function extractSalaryFromText(text) {
    const match = cleanText(text || '').match(/\$[\d,]+(?:\s*-\s*\$?[\d,]+)?(?:\s*(?:Annually|Hourly|Monthly|Yearly))?/i);
    return match ? cleanText(match[0]) : '';
  }

  function extractPostedDateFromText(text) {
    const match = cleanText(text || '').match(/\b(?:Job\s+)?Posted\s+(?:Today|Yesterday|\d+\s+(?:Days?|Hours?|Weeks?|Months?)\s+Ago)\b/i);
    return match ? cleanText(match[0].replace(/^Job\s+/i, '')) : '';
  }

  function isGenericBuiltInJobsHeading(text) {
    const cleaned = cleanText(text || '').toLowerCase();
    if (/^(?:top|best|recommended|matched)\s+.*\bjobs\b/.test(cleaned)) return true;
    return new Set([
      'top tech jobs & startup jobs',
      'best tech jobs & startup jobs',
      'jobs at companies',
      'job matches',
      'recommended jobs',
      'matched jobs'
    ]).has(cleaned);
  }

  function getBuiltInUrlJobId() {
    try {
      const currentUrl = new URL(window.location.href);
      return currentUrl.searchParams.get('jobid') || (currentUrl.pathname.match(/\/job\/[^/]+\/(\d+)/)?.[1] || '');
    } catch (e) {
      return '';
    }
  }

  function getObjectPathValue(obj, paths) {
    for (const path of paths) {
      let value = obj;
      for (const key of path.split('.')) {
        value = value?.[key];
      }
      if (!isMissingField(value)) return value;
    }
    return '';
  }

  function stringifyLocationValue(value) {
    if (!value) return '';
    if (typeof value === 'string') return cleanText(value);
    if (Array.isArray(value)) {
      return value.map(stringifyLocationValue).filter(Boolean).join('; ');
    }

    const address = value.address || value;
    return [
      address.city,
      address.location,
      address.addressLocality,
      address.region,
      address.state,
      address.addressRegion,
      address.country,
      address.addressCountry
    ].filter(Boolean).map(cleanText).filter(Boolean).join(', ');
  }

  function stringifyJobScalar(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number') return cleanText(String(value));
    if (Array.isArray(value)) return value.map(stringifyJobScalar).filter(Boolean).join(', ');
    if (typeof value === 'object') {
      if (value.minValue && value.maxValue) {
        return `$${Number(value.minValue).toLocaleString()} - $${Number(value.maxValue).toLocaleString()}`;
      }
      if (value.value) return stringifyJobScalar(value.value);
      if (value.name) return stringifyJobScalar(value.name);
      if (value.label) return stringifyJobScalar(value.label);
    }
    return '';
  }

  function objectContainsValue(obj, expectedValue, depth = 0) {
    if (!expectedValue || depth > 5 || obj === null || obj === undefined) return false;
    if (typeof obj === 'string' || typeof obj === 'number') {
      return String(obj) === String(expectedValue);
    }
    if (typeof obj !== 'object') return false;

    return Object.values(obj).some(value => objectContainsValue(value, expectedValue, depth + 1));
  }

  function isBuiltInJobLikeObject(obj, jobId = '') {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;

    const title = getObjectPathValue(obj, ['title', 'jobTitle', 'name']);
    const company = getObjectPathValue(obj, [
      'companyName',
      'company.name',
      'hiringOrganization.name',
      'organization.name',
      'employer.name'
    ]);
    const description = getObjectPathValue(obj, ['description', 'jobDescription', 'body', 'content']);
    const idMatches = !jobId || objectContainsValue(obj, jobId);

    return idMatches && !isMissingField(title) && (!isMissingField(company) || !isMissingField(description));
  }

  function findBuiltInJobObjectInValue(value, jobId = '', depth = 0, seen = new Set()) {
    if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return null;
    seen.add(value);

    if (isBuiltInJobLikeObject(value, jobId)) {
      return value;
    }

    const children = Array.isArray(value) ? value : Object.values(value);
    for (const child of children) {
      const found = findBuiltInJobObjectInValue(child, jobId, depth + 1, seen);
      if (found) return found;
    }

    return null;
  }

  function parseJsonCandidate(text) {
    const raw = (text || '').trim();
    if (!raw || !/^[\[{]/.test(raw)) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function extractBuiltinCallData(callName) {
    const marker = `Builtin.${callName}(`;

    for (const script of document.querySelectorAll('script')) {
      const text = script.textContent || '';
      const start = text.indexOf(marker);
      if (start === -1) continue;

      const jsonStart = text.indexOf('{', start + marker.length);
      if (jsonStart === -1) continue;

      let depth = 0;
      let inString = false;
      let escaped = false;

      for (let i = jsonStart; i < text.length; i += 1) {
        const ch = text[i];

        if (escaped) {
          escaped = false;
          continue;
        }

        if (ch === '\\') {
          escaped = inString;
          continue;
        }

        if (ch === '"') {
          inString = !inString;
          continue;
        }

        if (inString) continue;

        if (ch === '{') depth += 1;
        if (ch === '}') depth -= 1;

        if (depth === 0) {
          try {
            return JSON.parse(text.slice(jsonStart, i + 1));
          } catch (e) {
            break;
          }
        }
      }
    }

    return null;
  }

  function jobObjectToBuiltInData(job) {
    const jobData = createEmptyJobData();
    if (!job) return jobData;

    const canonicalUrl = stringifyJobScalar(getObjectPathValue(job, ['url', 'canonicalUrl', 'canonicalJobUrl']));
    if (canonicalUrl) {
      jobData.url = canonicalUrl;
    }
    jobData.title = stringifyJobScalar(getObjectPathValue(job, ['title', 'jobTitle', 'name']));
    jobData.company = stringifyJobScalar(getObjectPathValue(job, [
      'companyName',
      'company.name',
      'hiringOrganization.name',
      'organization.name',
      'employer.name'
    ]));
    jobData.location = stringifyLocationValue(getObjectPathValue(job, [
      'location',
      'locations',
      'jobLocation',
      'address',
      'primaryLocation',
      'locationName',
      'geoLocations'
    ]));
    jobData.workType = stringifyJobScalar(getObjectPathValue(job, ['workType', 'workplaceType', 'remoteType', 'workplace']));
    if (!jobData.workType) {
      if (job.isRemote && job.isHybrid) jobData.workType = 'Remote or Hybrid';
      else if (job.isRemote) jobData.workType = 'Remote';
      else if (job.isHybrid) jobData.workType = 'Hybrid';
      else if (job.isOnSite) jobData.workType = 'In-Office';
    }
    jobData.employmentType = stringifyJobScalar(getObjectPathValue(job, ['employmentType', 'jobType', 'type', 'experienceLevel', 'experience']));
    jobData.salary = stringifyJobScalar(getObjectPathValue(job, ['salary', 'salaryRange', 'compensation', 'baseSalary']));
    if (!jobData.salary && (job.salaryMin || job.salaryMax || job.salarySingle)) {
      const salaryType = job.salaryType ? ` ${String(job.salaryType).replace(/ly$/i, 'ly')}` : '';
      if (job.salaryMin && job.salaryMax) {
        jobData.salary = `$${Number(job.salaryMin).toLocaleString()}-$${Number(job.salaryMax).toLocaleString()}${salaryType}`;
      } else {
        jobData.salary = `$${Number(job.salarySingle || job.salaryMin || job.salaryMax).toLocaleString()}${salaryType}`;
      }
    }
    jobData.postedDate = stringifyJobScalar(getObjectPathValue(job, ['postedDate', 'datePosted', 'createdAt', 'publishedAt', 'lastUpdated']));
    if (Number.isFinite(Number(job.applyCount)) && Number(job.applyCount) > 0) {
      jobData.applicants = `${Number(job.applyCount).toLocaleString()} applicants`;
    } else if (job.isEarlyApplicant) {
      jobData.applicants = 'Be an Early Applicant';
    }
    jobData.description = cleanBuiltInDescription(stringifyJobScalar(getObjectPathValue(job, ['description', 'jobDescription', 'body', 'content', 'bodySummary'])));

    if (Array.isArray(job.industries)) {
      jobData.skills = job.industries.map(industry => stringifyJobScalar(industry)).filter(Boolean);
    } else if (Array.isArray(job.industry)) {
      jobData.skills = job.industry.map(industry => stringifyJobScalar(industry)).filter(Boolean);
    }

    return jobData;
  }

  function extractBuiltInHydratedJobData() {
    const jobId = getBuiltInUrlJobId();
    const candidates = [];
    const matchInitData = extractBuiltinCallData('jobMatchInit');

    if (Array.isArray(matchInitData?.jobs)) {
      const selectedJob = matchInitData.jobs.find(job => String(job.id) === String(jobId)) || matchInitData.jobs[0];
      return jobObjectToBuiltInData(selectedJob);
    }

    for (const script of document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"], script#__NEXT_DATA__')) {
      const text = script.textContent || '';
      if (jobId && !text.includes(jobId)) continue;
      const parsed = parseJsonCandidate(text);
      if (parsed) candidates.push(parsed);
    }

    try {
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        const text = window.localStorage.getItem(key) || '';
        if (!/^[\[{]/.test(text.trim())) continue;
        if (jobId && !text.includes(jobId)) continue;
        const parsed = parseJsonCandidate(text);
        if (parsed) candidates.push(parsed);
      }
    } catch (e) {}

    for (const candidate of candidates) {
      const job = findBuiltInJobObjectInValue(candidate, jobId);
      if (!job) continue;
      return jobObjectToBuiltInData(job);
    }

    return createEmptyJobData();
  }

  function getBuiltInJobMatchItem() {
    const jobId = getBuiltInUrlJobId();
    if (jobId) {
      const applyLink = document.querySelector(`a[href*="/${CSS.escape(jobId)}"]`);
      const matchedItem = applyLink?.closest('.job-match-item');
      if (matchedItem) return matchedItem;
    }

    return document.querySelector('.job-match-item');
  }

  function extractBuiltInJobMatchDomData() {
    const item = getBuiltInJobMatchItem();
    const jobData = createEmptyJobData();
    if (!item) return jobData;

    const itemText = item.innerText || '';
    const description = itemText
      .replace(/^[\s\S]*?\bThe Role\b/i, 'The Role')
      .replace(/\bThe Company\b[\s\S]*$/i, '')
      .trim();

    jobData.title = cleanText(item.querySelector('h3')?.textContent || '');
    jobData.company = cleanText(item.querySelector('h2.text-pretty-blue, h2')?.textContent || '');
    jobData.location = extractBuiltInLocationFromText(itemText);
    jobData.workType = extractBuiltInWorkTypeFromText(itemText);
    jobData.salary = extractSalaryFromText(itemText);
    jobData.postedDate = extractPostedDateFromText(itemText);
    jobData.applicants = extractApplicantsValue(itemText);
    jobData.description = normalizeSerializedDescription(description);

    const industryText = cleanText(Array.from(item.querySelectorAll('div, p, span'))
      .map(el => el.textContent || '')
      .find(text => text.includes('•')) || '');
    if (industryText) {
      jobData.skills = industryText.split('•').map(skill => cleanText(skill)).filter(Boolean);
    }

    return jobData;
  }

  function extractBuiltInDescriptionFromDom() {
    const descEl = queryMultipleIn(document, [
      '.job-description',
      '.description',
      '[class*="job-description"]',
      '[data-testid*="description"]',
      '[data-testid*="job-description"]',
      '.job-post-item'
    ]);

    if (!descEl) return '';

    const text = getDescriptionElementText(descEl);
    const match = text.match(/\b(?:The Role|About the Role|Job Description|Description|What You(?:'|’)ll Do|Responsibilities)\b[\s\S]*/i);
    const description = normalizeSerializedDescription(match ? match[0] : text);
    return description.replace(/\b(?:Similar Jobs|Similar Companies Hiring|Gallery|Sign up now Access later)\b[\s\S]*$/i, '').trim();
  }

  function extractBuiltInDomJobData() {
    const jobData = createEmptyJobData();
    const bodyText = document.body?.innerText || '';
    const titleCompany = parseTitleCompanyFromDocumentTitle();

    const titleCandidates = [
      extractBuiltInJobMatchDomData().title,
      getTextContent('h1.fw-extrabold'),
      getTextContent('.job-header h1'),
      getTextContent('[data-testid*="job-title"]'),
      getTextContent('h1')
    ].filter(title => title && !isGenericBuiltInJobsHeading(title));

    jobData.title =
      titleCandidates[0] ||
      (isLikelyJobTitle(titleCompany.title) ? titleCompany.title : '') ||
      extractTitleFromMeta(document);

    jobData.company =
      getTextContent([
        'a[href*="/company/"] span.fw-medium',
        'a[href*="/company/"] h2',
        'a[href*="/company/"]',
        '.company-name',
        '.job-post-item h2'
      ]) ||
      titleCompany.company;

    jobData.description = extractBuiltInDescriptionFromDom();
    jobData.location =
      getTextContent('.attribute-section .font-barlow.text-gray-03') ||
      extractBuiltInLocationFromText(bodyText);
    jobData.workType = extractBuiltInWorkTypeFromText(bodyText);

    return jobData;
  }

  function waitForBuiltInJobDetails(timeout = 5000) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const check = () => {
        const hasStructuredData = Boolean(extractJsonLd() || extractBuiltinInitData());
        const hasHydratedJob = !isMissingField(extractBuiltInHydratedJobData().title);
        const hasVisibleJob = Boolean(queryMultipleIn(document, [
          '.job-post-item h1',
          'h1.fw-extrabold',
          '[data-testid*="job-title"]',
          '.job-description',
          '[class*="job-description"]'
        ]));

        if (hasStructuredData || hasHydratedJob || hasVisibleJob || Date.now() - startTime >= timeout) {
          resolve(hasStructuredData || hasHydratedJob || hasVisibleJob);
          return;
        }

        setTimeout(check, 200);
      };

      check();
    });
  }

  function extractLinkedInStructuredJobData() {
    const jobData = createEmptyJobData();
    const jobPosting = extractJsonLd();
    const titleCompany = parseTitleCompanyFromDocumentTitle();
    const metaTitle = extractTitleFromMeta(document);
    const metaDescription = extractMetaContent([
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]'
    ]);
    const canonicalUrl = extractCanonicalUrl();

    if (jobPosting) {
      jobData.title = jobPosting.title || '';
      jobData.company = jobPosting.hiringOrganization?.name || '';
      jobData.location = extractJobPostingLocation(jobPosting);
      jobData.employmentType = Array.isArray(jobPosting.employmentType)
        ? jobPosting.employmentType.join(', ')
        : (jobPosting.employmentType || '');
      jobData.postedDate = jobPosting.datePosted || '';
      jobData.description = cleanBuiltInDescription(jobPosting.description || '');
      jobData.salary = extractSalaryFromJobPosting(jobPosting);

      if (typeof jobPosting.jobBenefits === 'string') {
        jobData.benefits = jobPosting.jobBenefits.split(',').map(b => b.trim()).filter(Boolean);
      } else if (Array.isArray(jobPosting.jobBenefits)) {
        jobData.benefits = jobPosting.jobBenefits;
      }

      if (jobPosting.industry) {
        jobData.skills = Array.isArray(jobPosting.industry) ? jobPosting.industry : [jobPosting.industry];
      }
    }

    if (!jobData.title && isLikelyJobTitle(titleCompany.title)) {
      jobData.title = titleCompany.title;
    }
    if (!jobData.title && isLikelyJobTitle(metaTitle)) {
      jobData.title = metaTitle;
    }
    if (!jobData.company) {
      jobData.company = titleCompany.company || '';
    }
    if (!jobData.description && metaDescription.length > 300) {
      jobData.description = metaDescription;
    }
    if (canonicalUrl) {
      jobData.url = canonicalUrl;
    }

    return jobData;
  }

  function extractLinkedInSemanticJobData() {
    const root = getJobDetailRoot();
    const jobData = createEmptyJobData();
    const titleCompany = parseTitleCompanyFromDocumentTitle();
    const mainText = getMainText(root);
    const topCardText = getTopCardText(root);

    jobData.title =
      (isLikelyJobTitle(titleCompany.title) ? titleCompany.title : '') ||
      extractTitleFromMeta(root) ||
      extractTitleFromVisibleText(root, titleCompany.title) ||
      extractTitleFromVisibleText(root) ||
      '';
    jobData.company = extractCompanyFromLinks(root) || titleCompany.company || '';
    const headerStrippedTopCardText = stripKnownJobHeaderText(topCardText, [jobData.company, jobData.title]);
    const headerStrippedMainText = stripKnownJobHeaderText(mainText, [jobData.company, jobData.title]);
    jobData.location =
      extractLocationFromMetaLine(root) ||
      extractLocationFromSemanticNodes(root) ||
      extractLocationFromText(headerStrippedTopCardText) ||
      extractLocationFromText(headerStrippedMainText) ||
      extractLocationFromText(topCardText) ||
      extractLocationFromText(mainText);
    jobData.location = cleanLocationCandidate(jobData.location, [jobData.company, jobData.title]);
    jobData.workType = extractWorkType();
    jobData.employmentType = extractEmploymentType();
    jobData.salary = extractSalary();
    jobData.postedDate = extractPostedDate();
    jobData.applicants = extractApplicants();
    jobData.description = extractDescription();
    jobData.skills = extractSkills();
    jobData.benefits = extractBenefits();
    jobData.companyDescription = getTextContent(SELECTORS.companyDescription);

    return jobData;
  }

  function extractLinkedInSelectorJobData() {
    return {
      ...createEmptyJobData(),
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
      url: extractJobUrl()
    };
  }

  function applyLinkedInLegacyFallbacks(jobData) {
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
      const titleCompanyText = parseTitleCompanyFromDocumentTitle();
      const strippedMainText = stripKnownJobHeaderText(getMainText(detailRoot), [
        jobData.company,
        jobData.title,
        titleCompanyText.company,
        titleCompanyText.title
      ]);
      jobData.location =
        extractLocationFromMetaLine(detailRoot) ||
        extractLocationFromSemanticNodes(detailRoot) ||
        extractLocationFromText(strippedMainText) ||
        extractLocationFromText(getMainText(detailRoot));
    }
    jobData.location = cleanLocationCandidate(jobData.location, [
      jobData.company,
      jobData.title,
      titleCompanyFromDocTitle.company,
      titleCompanyFromDocTitle.title
    ]);

    return jobData;
  }

  async function finalizeLinkedInJobData(jobData) {
    if (!jobData.title && !jobData.company) {
      await new Promise(r => setTimeout(r, 500));
      jobData.title = jobData.title || getTextContent(SELECTORS.jobTitle);
      jobData.company = jobData.company || getTextContent(SELECTORS.companyName);

      if (!jobData.title && !jobData.company) {
        return { error: 'incomplete_data', partial: jobData };
      }
    }

    return { success: true, data: jobData };
  }

  async function extractLinkedInJobDataLegacy() {
    const jobData = applyLinkedInLegacyFallbacks(extractLinkedInSelectorJobData());
    return finalizeLinkedInJobData(jobData);
  }

  async function extractLinkedInJobDataRobust() {
    const jobData = fillMissingJobData(
      createEmptyJobData(),
      extractLinkedInStructuredJobData(),
      extractLinkedInSemanticJobData(),
      extractLinkedInSelectorJobData()
    );

    applyLinkedInLegacyFallbacks(jobData);
    return finalizeLinkedInJobData(jobData);
  }

  async function validateLinkedInJobPage() {
    const isJobPage = window.location.href.includes('/jobs/') || window.location.href.includes('linkedin.com/jobs');
    if (!isJobPage) {
      return { error: 'not_linkedin_jobs' };
    }

    const isSearchResults = window.location.href.includes('search-results') || window.location.href.includes('currentJobId=');
    await waitForJobDetails(isSearchResults ? 5000 : 3000);

    const jobDetail = queryMultipleIn(document, SELECTORS.jobDetailContainer);
    if (!jobDetail) {
      const hasCurrentJobId = window.location.href.includes('currentJobId=');
      const jobsList = document.querySelector('.jobs-search-results-list, .scaffold-layout__list, [class*="jobs-search-results"]');
      if (jobsList && !hasCurrentJobId) {
        return { error: 'no_job_selected' };
      }
      if (!hasCurrentJobId) {
        return { error: 'no_job_data' };
      }
    }

    return null;
  }

  /**
   * BuiltIn.com specific extraction
   */
  async function extractBuiltInJobData() {
    await waitForBuiltInJobDetails();

    const jobPosting = extractJsonLd();
    const initData = extractBuiltinInitData();
    const hydratedData = extractBuiltInHydratedJobData();
    const jobMatchDomData = extractBuiltInJobMatchDomData();
    const domData = extractBuiltInDomJobData();
    
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
      
      jobData.location = extractJobPostingLocation(jobPosting);
      jobData.employmentType = Array.isArray(jobPosting.employmentType)
        ? jobPosting.employmentType.join(', ')
        : (jobPosting.employmentType || '');
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

    fillMissingJobData(jobData, hydratedData, jobMatchDomData, domData);

    if (isGenericBuiltInJobsHeading(jobData.title) && !jobData.description) {
      jobData.title = '';
    }

    // Fallback to DOM if JSON-LD/Init missed something
    if (!jobData.title) {
      const fallbackTitle = getTextContent('h1.fw-extrabold') || getTextContent('.job-header h1');
      if (!isGenericBuiltInJobsHeading(fallbackTitle)) {
        jobData.title = fallbackTitle;
      }
    }
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

    if (!jobData.title) {
      return { error: 'incomplete_data', partial: jobData };
    }

    return { success: true, data: jobData };
  }

  function cleanBuiltInDescription(html) {
    if (!html) return '';
    const temp = document.createElement('div');
    temp.innerHTML = html;
    return getDescriptionElementText(temp);
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
    const hostname = window.location.hostname;
    const isLinkedIn = hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
    const isBuiltIn = hostname === 'builtin.com' || hostname === 'www.builtin.com';

    await loadSettings();

    if (isBuiltIn) {
      return await extractBuiltInJobData();
    }

    if (!isLinkedIn) {
      return { error: 'not_supported_site' };
    }

    const validationError = await validateLinkedInJobPage();
    if (validationError) {
      return validationError;
    }

    if (currentSettings.parserStrategy === 'legacy') {
      return await extractLinkedInJobDataLegacy();
    }

    return await extractLinkedInJobDataRobust();
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
