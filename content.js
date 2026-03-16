/**
 * LinkedIn Job Description Extractor
 * Content script that extracts job information from LinkedIn job pages
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
      'a[href*="/jobs/view/"]',
      '.t-24.t-bold',
      '.jobs-details-top-card__job-title',
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
    const parts = raw.split('|').map((part) => cleanText(part)).filter(Boolean);
    if (parts.length >= 2) {
      return {
        title: parts[0] || '',
        company: parts[1] === 'LinkedIn' ? '' : (parts[1] || '')
      };
    }
    return { title: '', company: '' };
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
    
    return '';
  }

  /**
   * Extract work type (Remote, Hybrid, On-site)
   */
  function extractWorkType() {
    const root = getJobDetailRoot();
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
          const text = (el.textContent || '').toLowerCase();
          if (text.includes('remote')) return 'Remote';
          if (text.includes('hybrid')) return 'Hybrid';
          if (text.includes('on-site') || text.includes('onsite')) return 'On-site';
        }
      } catch (e) {}
    }
    
    // Check in the primary description area
    const descContainers = root.querySelectorAll('.job-details-jobs-unified-top-card__primary-description-container, .job-details-jobs-unified-top-card__job-insight');
    for (const container of descContainers) {
      const text = (container.textContent || '').toLowerCase();
      if (text.includes('remote')) return 'Remote';
      if (text.includes('hybrid')) return 'Hybrid';
      if (text.includes('on-site') || text.includes('onsite')) return 'On-site';
    }

    const topCardText = getTopCardText(root).toLowerCase();
    if (topCardText.includes(' remote')) return 'Remote';
    if (topCardText.includes(' hybrid')) return 'Hybrid';
    if (topCardText.includes('on-site') || topCardText.includes(' onsite')) return 'On-site';
    
    return '';
  }

  /**
   * Extract employment type (Full-time, Part-time, Contract, etc.)
   */
  function extractEmploymentType() {
    const root = getJobDetailRoot();
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
          const text = (el.textContent || '').toLowerCase();
          if (text.includes('full-time') || text.includes('full time')) return 'Full-time';
          if (text.includes('part-time') || text.includes('part time')) return 'Part-time';
          if (text.includes('contract')) return 'Contract';
          if (text.includes('internship')) return 'Internship';
          if (text.includes('temporary')) return 'Temporary';
        }
      } catch (e) {}
    }

    const topCardText = getTopCardText(root).toLowerCase();
    if (topCardText.includes('full-time') || topCardText.includes('full time')) return 'Full-time';
    if (topCardText.includes('part-time') || topCardText.includes('part time')) return 'Part-time';
    if (topCardText.includes('contract')) return 'Contract';
    if (topCardText.includes('internship')) return 'Internship';
    if (topCardText.includes('temporary')) return 'Temporary';
    
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
    
    return '';
  }

  /**
   * Extract number of applicants
   */
  function extractApplicants() {
    const root = getJobDetailRoot();
    const selectors = [
      '.jobs-unified-top-card__applicant-count',
      '.job-details-jobs-unified-top-card__primary-description-container .tvm__text--low-emphasis',
      '.tvm__text--positive',
      '.num-applicants__caption',
      '[class*="applicant"]'
    ];
    
    for (const selector of selectors) {
      try {
        const el = root.querySelector(selector);
        if (el) {
          const text = el.textContent || '';
          if (text.match(/\d+.*applicant/i) || text.match(/over\s+\d+/i)) {
            return cleanText(text);
          }
        }
      } catch (e) {}
    }
    
    // Search for applicant patterns in the page
    const allElements = root.querySelectorAll('span, div, p');
    for (const el of allElements) {
      const text = el.textContent || '';
      if (text.match(/\d+\s*applicant/i) || text.match(/over\s+\d+.*clicked\s+apply/i)) {
        return cleanText(text);
      }
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
    
    // Strategy 2: Look for "About the job" section
    if (!descEl) {
      const headings = root.querySelectorAll('h2, h3, h4, [class*="heading"]');
      for (const heading of headings) {
        if (heading.textContent && heading.textContent.toLowerCase().includes('about the job')) {
          // Get the next sibling or parent's content
          let content = heading.nextElementSibling;
          if (content) {
            descEl = content;
            break;
          }
          // Try parent
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
    
    if (!descEl) return '';
    
    // Get the inner text and clean it up
    let text = descEl.innerText || descEl.textContent || '';
    
    // Clean up the text while preserving line breaks
    text = text
      .replace(/[ \t]+/g, ' ')     // Collapse spaces/tabs
      .replace(/\n{3,}/g, '\n\n')  // Max 2 newlines
      .trim();
    
    // Strip "About the job" or common headers from the start
    const headerRegex = /^(about the job|job description|description)\s*/i;
    text = text.replace(headerRegex, '').trim();
    
    return text;
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
   * Main extraction function
   */
  async function extractJobData() {
    // Check if we're on a job page
    const isJobPage = window.location.href.includes('/jobs/') || 
                      window.location.href.includes('linkedin.com/jobs');
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
      const viewLink = detailRoot.querySelector('a[href*="/jobs/view/"]');
      const viewLinkText = viewLink ? cleanText(viewLink.textContent || '') : '';
      jobData.title = viewLinkText || titleCompanyFromDocTitle.title || '';
    }
    if (!jobData.company) {
      jobData.company = extractCompanyFromLinks(detailRoot) || titleCompanyFromDocTitle.company || '';
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

})();
