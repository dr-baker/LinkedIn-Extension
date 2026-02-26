/**
 * LinkedIn JD Extractor - Popup Script
 * Handles UI logic and communication with content script
 */

(function() {
  'use strict';

  // DOM element references
  const elements = {
    loading: document.getElementById('loading'),
    notLinkedIn: document.getElementById('not-linkedin'),
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
    refreshBtn: document.getElementById('refresh-btn')
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
    const views = ['loading', 'notLinkedIn', 'noJob', 'jobData'];
    views.forEach(view => {
      elements[view].classList.toggle('hidden', view !== viewName);
    });
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

  /**
   * Render skills as tags
   */
  function renderSkills(skills) {
    if (!skills || skills.length === 0) {
      elements.skillsSection.classList.add('hidden');
      return;
    }
    
    elements.skillsSection.classList.remove('hidden');
    elements.skills.innerHTML = skills
      .map(skill => `<span class="skill-tag">${escapeHtml(skill)}</span>`)
      .join('');
  }

  /**
   * Render benefits as list
   */
  function renderBenefits(benefits) {
    if (!benefits || benefits.length === 0) {
      elements.benefitsSection.classList.add('hidden');
      return;
    }
    
    elements.benefitsSection.classList.remove('hidden');
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
    elements.salary.textContent = formatValue(data.salary);
    elements.workType.textContent = formatValue(data.workType);
    elements.employmentType.textContent = formatValue(data.employmentType);
    elements.postedDate.textContent = formatValue(data.postedDate);
    elements.description.textContent = formatDescription(data.description);
    
    renderSkills(data.skills);
    renderBenefits(data.benefits);
    
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
      data.description || 'No description available',
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
      
      // Check if we're on LinkedIn
      if (!tab.url || !tab.url.includes('linkedin.com')) {
        showView('notLinkedIn');
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
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Try again
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractJobData' });
        handleExtractionResult(response);
      }
    } catch (err) {
      console.error('Extraction error:', err);
      showView('notLinkedIn');
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
          showView('notLinkedIn');
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

