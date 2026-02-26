/**
 * Settings page script
 * Handles settings UI and storage
 */

(function() {
  'use strict';

  // DOM element references
  const elements = {
    autoCopyToggle: document.getElementById('auto-copy-toggle'),
    autoSaveToggle: document.getElementById('auto-save-toggle'),
    fileFormat: document.getElementById('file-format'),
    downloadFolder: document.getElementById('download-folder'),
    selectFolderBtn: document.getElementById('select-folder-btn'),
    saveOptionsSection: document.getElementById('save-options-section'),
    statusBanner: document.getElementById('status-banner')
  };

  // Default settings
  const defaultSettings = {
    autoCopy: false,
    autoSave: false,
    fileFormat: 'text',
    downloadFolder: ''
  };

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
   * Load settings from storage
   */
  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['settings']);
      const settings = result.settings || defaultSettings;
      
      // Update UI
      elements.autoCopyToggle.checked = settings.autoCopy || false;
      elements.autoSaveToggle.checked = settings.autoSave || false;
      elements.fileFormat.value = settings.fileFormat || 'text';
      elements.downloadFolder.value = settings.downloadFolder || '';
      
      // Show/hide save options section based on auto-save toggle
      updateSaveOptionsVisibility();
      
      return settings;
    } catch (err) {
      console.error('Failed to load settings:', err);
      showStatus('Failed to load settings', 'error');
      return defaultSettings;
    }
  }

  /**
   * Save settings to storage
   */
  async function saveSettings() {
    try {
      const settings = {
        autoCopy: elements.autoCopyToggle.checked,
        autoSave: elements.autoSaveToggle.checked,
        fileFormat: elements.fileFormat.value,
        downloadFolder: elements.downloadFolder.value
      };
      
      await chrome.storage.sync.set({ settings });
      showStatus('Settings saved!', 'success');
      return true;
    } catch (err) {
      console.error('Failed to save settings:', err);
      showStatus('Failed to save settings', 'error');
      return false;
    }
  }

  /**
   * Update visibility of save options section
   */
  function updateSaveOptionsVisibility() {
    if (elements.autoSaveToggle.checked) {
      elements.saveOptionsSection.style.display = 'block';
    } else {
      elements.saveOptionsSection.style.display = 'none';
    }
  }

  /**
   * Handle folder selection
   * Note: Chrome extensions can't directly browse folders for security reasons.
   * The folder path will be used as a prefix in the filename, and the browser will
   * attempt to create the folder structure in the Downloads directory.
   */
  async function handleFolderSelection() {
    const folderPath = prompt(
      'Enter the folder path where you want to save files:\n\n' +
      'Examples:\n' +
      '  - "JobDescriptions" (saves to Downloads/JobDescriptions/)\n' +
      '  - "LinkedIn/Jobs" (saves to Downloads/LinkedIn/Jobs/)\n\n' +
      'Leave empty to save directly to Downloads folder.\n' +
      'Note: The browser will create the folder structure if it doesn\'t exist.',
      elements.downloadFolder.value || ''
    );
    
    if (folderPath !== null) {
      elements.downloadFolder.value = folderPath.trim();
      await saveSettings();
    }
  }

  /**
   * Initialize event listeners
   */
  function initEventListeners() {
    // Auto-copy toggle
    elements.autoCopyToggle.addEventListener('change', async () => {
      await saveSettings();
    });

    // Auto-save toggle
    elements.autoSaveToggle.addEventListener('change', async () => {
      updateSaveOptionsVisibility();
      await saveSettings();
    });

    // File format change
    elements.fileFormat.addEventListener('change', async () => {
      await saveSettings();
    });

    // Folder selection button
    elements.selectFolderBtn.addEventListener('click', handleFolderSelection);

    // Download folder input (allow manual entry)
    elements.downloadFolder.addEventListener('blur', async () => {
      await saveSettings();
    });
  }

  /**
   * Initialize the settings page
   */
  async function init() {
    initEventListeners();
    await loadSettings();
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

