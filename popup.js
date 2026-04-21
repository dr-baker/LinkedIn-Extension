/**
 * LinkedIn JD Extractor - Popup Script
 * Handles UI logic and communication with content script
 */

(function() {
  'use strict';

  // DOM element references
  const elements = {
    loading: document.getElementById('loading'),
    notSupported: document.getElementById('not-supported'),
    noJob: document.getElementById('no-job'),
    jobData: document.getElementById('job-data'),
    statusBanner: document.getElementById('status-banner'),
    
    // Job data elements
    jobTitle: document.getElementById('job-title'),
    companyName: document.getElementById('company-name'),
    location: document.getElementById('location'),
    salary: document.getElementById('salary'),
    workType: document.getElementById('work-type'),
    employmentType: document.getElementById('employment-type'),
    postedDate: document.getElementById('posted-date'),
    description: document.getElementById('description'),
    skills: document.getElementById('skills'),
    skillsSection: document.getElementById('skills-section'),
    benefits: document.getElementById('benefits'),
    benefitsSection: document.getElementById('benefits-section'),
    
    // Buttons
    copyBtn: document.getElementById('copy-btn'),
    downloadBtn: document.getElementById('download-btn'),
    refreshBtn: document.getElementById('refresh-btn'),

    // Action bar / completeness
    actionBar: document.getElementById('action-bar'),
    completeness: document.getElementById('completeness'),

    // Section status labels
    descriptionStatus: document.getElementById('description-status'),
    skillsStatus: document.getElementById('skills-status'),
    benefitsStatus: document.getElementById('benefits-status'),
    companyDescStatus: document.getElementById('company-desc-status'),

    // Section wrappers (for missing-state styling)
    descriptionSection: document.querySelector('.description-section'),

    // Extra fields
    applicants: document.getElementById('applicants'),
    applicantsSep: document.querySelector('.applicants-sep'),
    companyDescription: document.getElementById('company-description'),
    companyDescSection: document.getElementById('company-desc-section')
  };

  // Current job data cache
  let currentJobData = null;
  
  // Settings cache
  let settings = {
    autoCopy: false,
    autoSave: false,
    fileFormat: 'text',
    downloadFolder: ''
  };

  /**
   * Show a specific view and hide others
   */
  function showView(viewName) {
    const views = ['loading', 'notSupported', 'noJob', 'jobData'];
    views.forEach(view => {
      if (elements[view]) {
        elements[view].classList.toggle('hidden', view !== viewName);
      }
    });
    // Action bar is only shown when we have job data
    if (elements.actionBar) {
      elements.actionBar.classList.toggle('hidden', viewName !== 'jobData');
    }
  }

  /**
   * Check if a value should count as "missing"
   */
  function isMissing(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
  }

  /**
   * Mark an info-card as missing (amber) when its bound value is empty.
   */
  function setInfoField(cardSelector, valueEl, value) {
    const card = document.querySelector(cardSelector);
    const missing = isMissing(value);
    if (card) card.classList.toggle('is-missing', missing);
    valueEl.textContent = missing ? 'Not found' : value;
  }

  /**
   * Set section status pill + missing class on the section wrapper.
   */
  function setSectionStatus(sectionEl, statusEl, isEmpty, labelWhenPresent = '') {
    if (!sectionEl) return;
    sectionEl.classList.toggle('is-missing', isEmpty);
    if (!statusEl) return;
    if (isEmpty) {
      statusEl.textContent = 'Missing';
      statusEl.classList.add('missing');
    } else {
      statusEl.textContent = labelWhenPresent;
      statusEl.classList.remove('missing');
    }
  }

  /**
   * Update the completeness indicator in the action bar.
   */
  function updateCompleteness(data) {
    const tracked = [
      ['Title', data.title],
      ['Company', data.company],
      ['Location', data.location],
      ['Salary', data.salary],
      ['Work type', data.workType],
      ['Employment', data.employmentType],
      ['Posted', data.postedDate],
      ['Applicants', data.applicants],
      ['Description', data.description],
      ['Skills', data.skills],
      ['Benefits', data.benefits],
      ['Company description', data.companyDescription]
    ];

    const missing = tracked.filter(([, v]) => isMissing(v)).map(([name]) => name);
    const el = elements.completeness;
    if (!el) return;

    const dot = el.querySelector('.completeness-dot');
    const text = el.querySelector('.completeness-text');

    el.classList.remove('ok', 'warn');
    if (missing.length === 0) {
      el.classList.add('ok');
      text.textContent = 'All fields extracted';
      el.title = 'All tracked fields were found.';
    } else {
      el.classList.add('warn');
      text.textContent = `${missing.length} missing`;
      el.title = `Missing: ${missing.join(', ')}`;
    }
    void dot;
  }

  /**
   * Show status banner with message
   */
  function showStatus(message, type = 'success') {
    elements.statusBanner.className = `status-banner ${type}`;
    elements.statusBanner.querySelector('.status-icon').textContent = type === 'success' ? '✓' : '✗';
    elements.statusBanner.querySelector('.status-text').textContent = message;
    elements.statusBanner.classList.remove('hidden');
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      elements.statusBanner.classList.add('hidden');
    }, 3000);
  }

  /**
   * Format value for display (return '-' if empty)
   */
  function formatValue(value) {
    if (!value || (Array.isArray(value) && value.length === 0)) {
      return '-';
    }
    return value;
  }

  /**
   * Truncate description for display
   */
  function formatDescription(desc) {
    if (!desc) return 'No description available';
    return desc;
  }

  function isBulletLine(line) {
    return /^\s*(?:[-*•◦▪‣]|(?:\d+|[a-zA-Z])[.)])\s+/.test(line);
  }

  function getBulletContent(line) {
    return line.replace(/^\s*(?:[-*•◦▪‣]|(?:\d+|[a-zA-Z])[.)])\s+/, '').trim();
  }

  function splitDescriptionLines(desc) {
    const lines = (desc || '').replace(/\r\n/g, '\n').split('\n');
    const blocks = [];
    let paragraphLines = [];
    let bulletLines = [];

    function flushParagraph() {
      if (paragraphLines.length === 0) return;
      blocks.push({
        type: 'paragraph',
        lines: paragraphLines.slice()
      });
      paragraphLines = [];
    }

    function flushBullets() {
      if (bulletLines.length === 0) return;
      blocks.push({
        type: 'bullets',
        lines: bulletLines.slice()
      });
      bulletLines = [];
    }

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed) {
        flushParagraph();
        flushBullets();
        continue;
      }

      if (isBulletLine(line)) {
        flushParagraph();
        bulletLines.push(line);
        continue;
      }

      flushBullets();
      paragraphLines.push(trimmed);
    }

    flushParagraph();
    flushBullets();

    return blocks;
  }

  function formatDescriptionAsText(desc) {
    if (!desc) return 'No description available';

    const blocks = splitDescriptionLines(desc);
    if (blocks.length === 0) return formatDescription(desc);

    return blocks
      .map(block => {
        if (block.type === 'bullets') {
          return block.lines.map(line => `• ${getBulletContent(line)}`).join('\n');
        }

        return block.lines.join(' ').trim();
      })
      .join('\n\n');
  }

  function renderDescription(desc) {
    elements.description.innerHTML = '';

    if (!desc) {
      elements.description.textContent = 'No description available';
      return;
    }

    const fragment = document.createDocumentFragment();
    const blocks = splitDescriptionLines(desc);

    blocks.forEach(block => {
      if (block.type === 'bullets') {
        const list = document.createElement('ul');
        block.lines.forEach(line => {
          const item = document.createElement('li');
          item.textContent = getBulletContent(line);
          list.appendChild(item);
        });
        fragment.appendChild(list);
        return;
      }

      const paragraph = document.createElement('p');
      paragraph.textContent = block.lines.join(' ').trim();
      fragment.appendChild(paragraph);
    });

    if (!fragment.childNodes.length) {
      elements.description.textContent = formatDescription(desc);
      return;
    }

    elements.description.appendChild(fragment);
  }

  /**
   * Render skills as tags
   */
  function renderSkills(skills) {
    const isEmpty = !skills || skills.length === 0;
    elements.skillsSection.classList.remove('hidden');
    setSectionStatus(elements.skillsSection, elements.skillsStatus, isEmpty, `${skills ? skills.length : 0}`);

    if (isEmpty) {
      elements.skills.innerHTML = '';
      return;
    }

    elements.skills.innerHTML = skills
      .map(skill => `<span class="skill-tag">${escapeHtml(skill)}</span>`)
      .join('');
  }

  /**
   * Render benefits as list
   */
  function renderBenefits(benefits) {
    const isEmpty = !benefits || benefits.length === 0;
    elements.benefitsSection.classList.remove('hidden');
    setSectionStatus(elements.benefitsSection, elements.benefitsStatus, isEmpty, `${benefits ? benefits.length : 0}`);

    if (isEmpty) {
      elements.benefits.innerHTML = '';
      return;
    }

    elements.benefits.innerHTML = benefits
      .map(benefit => `<div class="benefit-item">${escapeHtml(benefit)}</div>`)
      .join('');
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Populate UI with job data
   */
  function displayJobData(data) {
    currentJobData = data;

    elements.jobTitle.textContent = formatValue(data.title);
    elements.companyName.textContent = formatValue(data.company);
    elements.location.textContent = formatValue(data.location);

    // Applicants in meta line — shown only when present
    if (!isMissing(data.applicants)) {
      elements.applicants.textContent = `${data.applicants} applicants`;
      elements.applicants.classList.remove('hidden');
      elements.applicantsSep.classList.remove('hidden');
    } else {
      elements.applicants.classList.add('hidden');
      elements.applicantsSep.classList.add('hidden');
    }

    // Company description — shown only when present
    if (!isMissing(data.companyDescription)) {
      elements.companyDescription.textContent = data.companyDescription;
      elements.companyDescSection.classList.remove('hidden');
      setSectionStatus(elements.companyDescSection, elements.companyDescStatus, false, '');
    } else {
      elements.companyDescSection.classList.add('hidden');
    }

    setInfoField('[data-field="salary"]', elements.salary, data.salary);
    setInfoField('[data-field="workType"]', elements.workType, data.workType);
    setInfoField('[data-field="employmentType"]', elements.employmentType, data.employmentType);
    setInfoField('[data-field="postedDate"]', elements.postedDate, data.postedDate);

    renderDescription(data.description);
    setSectionStatus(
      elements.descriptionSection,
      elements.descriptionStatus,
      isMissing(data.description),
      ''
    );

    renderSkills(data.skills);
    renderBenefits(data.benefits);

    updateCompleteness(data);

    showView('jobData');

    // Check settings and perform auto-actions
    performAutoActions(data);
  }

  /**
   * Copy job data to clipboard as formatted text
   */
  async function copyToClipboard() {
    if (!currentJobData) return;
    
    const text = formatJobDataAsText(currentJobData);
    
    try {
      await navigator.clipboard.writeText(text);
      showStatus('Copied to clipboard!', 'success');
    } catch (err) {
      console.error('Failed to copy:', err);
      showStatus('Failed to copy', 'error');
    }
  }

  /**
   * Format job data as readable text
   */
  function formatJobDataAsText(data) {
    const lines = [
      '═══════════════════════════════════════',
      `📋 ${data.title || 'Job Title'}`,
      '═══════════════════════════════════════',
      '',
      `🏢 Company: ${data.company || 'N/A'}`,
      `📍 Location: ${data.location || 'N/A'}`,
      `💼 Work Type: ${data.workType || 'N/A'}`,
      `⏰ Employment: ${data.employmentType || 'N/A'}`,
      `💰 Salary: ${data.salary || 'N/A'}`,
      `📅 Posted: ${data.postedDate || 'N/A'}`,
      `👥 Applicants: ${data.applicants || 'N/A'}`,
      '',
      '───────────────────────────────────────',
      '📝 DESCRIPTION',
      '───────────────────────────────────────',
      formatDescriptionAsText(data.description),
      ''
    ];
    
    if (data.skills && data.skills.length > 0) {
      lines.push('───────────────────────────────────────');
      lines.push('🛠️ SKILLS');
      lines.push('───────────────────────────────────────');
      lines.push(data.skills.join(', '));
      lines.push('');
    }
    
    if (data.benefits && data.benefits.length > 0) {
      lines.push('───────────────────────────────────────');
      lines.push('🎁 BENEFITS');
      lines.push('───────────────────────────────────────');
      data.benefits.forEach(b => lines.push(`• ${b}`));
      lines.push('');
    }

    if (data.companyDescription && data.companyDescription.trim()) {
      lines.push('───────────────────────────────────────');
      lines.push('🏛️ ABOUT THE COMPANY');
      lines.push('───────────────────────────────────────');
      lines.push(data.companyDescription.trim());
      lines.push('');
    }

    lines.push('───────────────────────────────────────');
    lines.push(`🔗 URL: ${data.url || window.location.href}`);
    lines.push(`📆 Extracted: ${new Date(data.extractedAt).toLocaleString()}`);
    lines.push('═══════════════════════════════════════');
    
    return lines.join('\n');
  }

  /**
   * Get filename with folder path prefix if set
   */
  function getFilename(extension) {
    const baseName = `job-${(currentJobData.company || 'unknown').replace(/\s+/g, '-')}-${Date.now()}.${extension}`;
    
    if (settings.downloadFolder && settings.downloadFolder.trim()) {
      const folder = settings.downloadFolder.trim().replace(/\/$/, ''); // Remove trailing slash
      return `${folder}/${baseName}`;
    }
    
    return baseName;
  }

  /**
   * Download job data as JSON file
   */
  function downloadAsJson() {
    if (!currentJobData) return;
    
    const blob = new Blob([JSON.stringify(currentJobData, null, 2)], {
      type: 'application/json'
    });
    
    const filename = getFilename('json');
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    
    showStatus('Downloaded!', 'success');
  }

  /**
   * Download job data as text file
   */
  function downloadAsText() {
    if (!currentJobData) return;
    
    const text = formatJobDataAsText(currentJobData);
    const blob = new Blob([text], {
      type: 'text/plain'
    });
    
    const filename = getFilename('txt');
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    
    showStatus('Downloaded!', 'success');
  }

  /**
   * Save job data to file based on settings
   */
  async function saveJobDataToFile(data) {
    if (settings.fileFormat === 'json') {
      downloadAsJson();
    } else {
      downloadAsText();
    }
  }

  /**
   * Load settings from storage
   */
  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['settings']);
      if (result.settings) {
        settings = { ...settings, ...result.settings };
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  /**
   * Perform auto-actions based on settings
   */
  async function performAutoActions(data) {
    // Auto-copy if enabled
    if (settings.autoCopy) {
      try {
        const text = formatJobDataAsText(data);
        await navigator.clipboard.writeText(text);
        showStatus('Auto-copied to clipboard!', 'success');
      } catch (err) {
        console.error('Failed to auto-copy:', err);
      }
    }

    // Auto-save if enabled
    if (settings.autoSave) {
      await saveJobDataToFile(data);
    }
  }

  /**
   * Extract job data from the current tab
   */
  async function extractFromCurrentTab() {
    showView('loading');
    
    try {
      // Get the current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab || !tab.url) {
        showView('notSupported');
        return;
      }

      const isSupported = tab.url.includes('linkedin.com') || tab.url.includes('builtin.com');
      
      if (!isSupported) {
        showView('notSupported');
        return;
      }
      
      // Inject content script if needed and send message
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractJobData' });
        handleExtractionResult(response);
      } catch (err) {
        // Content script might not be injected, try injecting it
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        
        // Wait a moment for the script to initialize
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Try again
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractJobData' });
        handleExtractionResult(response);
      }
    } catch (err) {
      console.error('Extraction error:', err);
      showView('notSupported');
      showStatus('Failed to extract data', 'error');
    }
  }

  /**
   * Handle the result from content script
   */
  function handleExtractionResult(result) {
    if (!result) {
      showView('noJob');
      return;
    }
    
    if (result.error) {
      switch (result.error) {
        case 'not_linkedin_jobs':
        case 'not_supported_site':
          showView('notSupported');
          break;
        case 'no_job_selected':
        case 'no_job_data':
          showView('noJob');
          break;
        case 'incomplete_data':
          if (result.partial) {
            displayJobData(result.partial);
            showStatus('Partial data extracted', 'error');
          } else {
            showView('noJob');
          }
          break;
        default:
          showView('noJob');
      }
      return;
    }
    
    if (result.success && result.data) {
      displayJobData(result.data);
    } else {
      showView('noJob');
    }
  }

  /**
   * Initialize event listeners
   */
  function initEventListeners() {
    elements.copyBtn.addEventListener('click', copyToClipboard);
    elements.downloadBtn.addEventListener('click', downloadAsJson);
    elements.refreshBtn.addEventListener('click', extractFromCurrentTab);
  }

  /**
   * Initialize the popup
   */
  async function init() {
    initEventListeners();
    await loadSettings();
    extractFromCurrentTab();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
