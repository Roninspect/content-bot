document.addEventListener('DOMContentLoaded', () => {
  // Navigation Tabs
  const tabs = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.view-panel');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      
      tab.classList.add('active');
      const targetPanel = document.getElementById(`${tab.dataset.tab}-view`);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });
  });

  // Settings Accordion Toggle Mechanic
  const accordionHeaders = document.querySelectorAll('.accordion-header');
  accordionHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const parentItem = header.parentElement;
      const isActive = parentItem.classList.contains('active');
      
      // Close all items
      document.querySelectorAll('.accordion-item').forEach(item => {
        item.classList.remove('active');
      });
      
      // Toggle current one
      if (!isActive) {
        parentItem.classList.add('active');
      }
    });
  });

  // UI Elements - Settings
  const settingsForm = document.getElementById('settings-form');
  const automationModeSelect = document.getElementById('automation-mode');
  const sbListNameInput = document.getElementById('sb-list-name');
  const sbBatchLimitInput = document.getElementById('sb-batch-limit');
  const wpUrlInput = document.getElementById('wp-url');
  const wpUsernameInput = document.getElementById('wp-username');
  const wpAppPasswordInput = document.getElementById('wp-app-password');
  const wpStatusSelect = document.getElementById('wp-status');
  const wpCategoryIdInput = document.getElementById('wp-category-id');
  const actionDelayInput = document.getElementById('action-delay');
  const concurrencySelect = document.getElementById('concurrency-limit');
  const promptTemplateInput = document.getElementById('prompt-template');
  const saveStatusMsg = document.getElementById('save-status-msg');
  const testModeToggle = document.getElementById('test-mode-toggle');
  const testModeFields = document.getElementById('test-mode-fields');
  const testKeywordsInput = document.getElementById('test-keywords');
  
  // Scheduling UI Elements
  const scheduleFields = document.getElementById('schedule-fields');
  const schedStartDateInput = document.getElementById('sched-start-date');
  const schedPostsPerDayInput = document.getElementById('sched-posts-per-day');
  const schedHoursStartInput = document.getElementById('sched-hours-start');
  const schedHoursEndInput = document.getElementById('sched-hours-end');

  // Custom GPT Rewrite UI Elements
  const gptRewriteToggle = document.getElementById('gpt-rewrite-toggle');
  const gptRewriteFields = document.getElementById('gpt-rewrite-fields');
  const customGptUrlInput = document.getElementById('custom-gpt-url');

  // Listicle Mode UI Elements
  const listicleToggle = document.getElementById('listicle-toggle');
  const listicleFields = document.getElementById('listicle-fields');
  const listicleGptUrlInput = document.getElementById('listicle-gpt-url');

  // Hardcoded Supabase Credentials
  const HARDCODED_SB_URL = 'https://wgsqlctbgflkfnjkcubb.supabase.co';
  const HARDCODED_SB_KEY = 'sb_publishable_Qz9vTBAZcjaLYAJYPbDAHA_jFOMGnJG';

  // Toggle field required status dynamically based on Test Mode
  function toggleRequiredFields(isTestMode) {
    const isPinterest = automationModeSelect.value === 'pinterest';
    const inputs = [
      sbListNameInput, sbBatchLimitInput
    ];
    if (!isPinterest) {
      inputs.push(wpUrlInput, wpUsernameInput, wpAppPasswordInput);
    }
    const schedInputs = [schedStartDateInput, schedPostsPerDayInput];
    const gptInputs = [customGptUrlInput];
    const listicleInputs = [listicleGptUrlInput];

    inputs.forEach(input => {
      if (input) {
        if (isTestMode) {
          input.removeAttribute('required');
        } else {
          input.setAttribute('required', 'required');
        }
      }
    });

    schedInputs.forEach(input => {
      if (input) {
        if (isTestMode || wpStatusSelect.value !== 'schedule') {
          input.removeAttribute('required');
        } else {
          input.setAttribute('required', 'required');
        }
      }
    });

    gptInputs.forEach(input => {
      if (input) {
        if (isTestMode || !gptRewriteToggle.checked) {
          input.removeAttribute('required');
        } else {
          input.setAttribute('required', 'required');
        }
      }
    });

    listicleInputs.forEach(input => {
      if (input) {
        if (isTestMode || !listicleToggle.checked) {
          input.removeAttribute('required');
        } else {
          input.setAttribute('required', 'required');
        }
      }
    });
  }

  // Update visibility of scheduling options
  function updateScheduleFieldsVisibility() {
    if (wpStatusSelect.value === 'schedule') {
      scheduleFields.classList.add('show');
      toggleRequiredFields(testModeToggle.checked);
    } else {
      scheduleFields.classList.remove('show');
      toggleRequiredFields(testModeToggle.checked);
    }
  }

  // Update visibility of GPT rewrite options
  function updateGptRewriteFieldsVisibility() {
    if (gptRewriteToggle.checked) {
      gptRewriteFields.classList.add('show');
      toggleRequiredFields(testModeToggle.checked);
    } else {
      gptRewriteFields.classList.remove('show');
      toggleRequiredFields(testModeToggle.checked);
    }
  }

  // Update visibility of listicle GPT options
  function updateListicleFieldsVisibility() {
    if (listicleToggle.checked) {
      listicleFields.classList.add('show');
      toggleRequiredFields(testModeToggle.checked);
    } else {
      listicleFields.classList.remove('show');
      toggleRequiredFields(testModeToggle.checked);
    }
  }

  wpStatusSelect.addEventListener('change', updateScheduleFieldsVisibility);
  gptRewriteToggle.addEventListener('change', updateGptRewriteFieldsVisibility);
  listicleToggle.addEventListener('change', updateListicleFieldsVisibility);

  function updateTestModeFieldsVisibility() {
    if (testModeToggle.checked) {
      testModeFields.classList.add('show');
    } else {
      testModeFields.classList.remove('show');
    }
  }

  testModeToggle.addEventListener('change', () => {
    toggleRequiredFields(testModeToggle.checked);
    updateTestModeFieldsVisibility();
  });

  // UI Elements - Controls & Stats
  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const btnStop = document.getElementById('btn-stop');
  const btnClearLogs = document.getElementById('btn-clear-logs');
  const btnCopyLogs = document.getElementById('btn-copy-logs');
  const globalStatusBadge = document.getElementById('global-status');
  
  const statProcessed = document.getElementById('stat-processed');
  const statRemaining = document.getElementById('stat-remaining');
  const statTotal = document.getElementById('stat-total');
  
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressPercentage = document.getElementById('progress-percentage');
  const terminalConsole = document.getElementById('terminal-console');

  // Default Prompt Template
  const DEFAULT_PROMPT = "Write a 1500-word highly engaging SEO article about {keyword} containing headings and a summary.";
  const DEFAULT_PINTEREST_PROMPT = `I need an engaging, SEO-optimized Pinterest title and description for the following keyword: "{keyword}"

Available annotations (use only what applies): {annotations}

Rules for annotations:
- From the list above, select ONLY the annotations that are directly and clearly relevant to "{keyword}".
- Do NOT force in annotations just because they were provided — irrelevant ones must be skipped entirely.
- Do NOT use any annotation (or keyword) that would alter, dilute, or shift the core meaning of "{keyword}".
- If none of the annotations are relevant, ignore the list and write the description using only the main keyword and natural long-tail variations.

Title requirements:
- Simple, clear, and attention-grabbing.
- Naturally include relevant long-tail keywords (no keyword stuffing).
- Maximum 70 characters.

Description requirements:
- 500–600 characters.
- Naturally incorporate 4–5 relevant keywords/long-tail phrases (from the keyword itself and, where applicable, the filtered annotations) — no forced or unnatural insertion.
- Must read naturally, like it's written for humans first, search engines second.

Output strictly in this JSON format, with no extra text before or after:
{
  "title": "Some title",
  "description": "Some description"
}`;

  let cachedArticlePrompt = DEFAULT_PROMPT;
  let cachedPinterestPrompt = DEFAULT_PINTEREST_PROMPT;
  let previousMode = 'article';

  function updateAutomationModeUI() {
    const isPinterest = automationModeSelect.value === 'pinterest';
    const wpAccordion = document.getElementById('wordpress-accordion');
    const gptSwitch = document.getElementById('gpt-rewrite-switch-group');
    const listicleSwitch = document.getElementById('listicle-switch-group');

    if (isPinterest) {
      if (wpAccordion) wpAccordion.style.display = 'none';
      if (gptSwitch) gptSwitch.style.display = 'none';
      if (gptRewriteFields) gptRewriteFields.classList.remove('show');
      if (listicleSwitch) listicleSwitch.style.display = 'none';
      if (listicleFields) listicleFields.classList.remove('show');
    } else {
      if (wpAccordion) wpAccordion.style.display = 'block';
      if (gptSwitch) gptSwitch.style.display = 'block';
      if (listicleSwitch) listicleSwitch.style.display = 'block';

      updateGptRewriteFieldsVisibility();
      updateListicleFieldsVisibility();
    }
    toggleRequiredFields(testModeToggle.checked);
  }

  automationModeSelect.addEventListener('change', () => {
    // Cache the current prompt to the old mode's key
    if (previousMode === 'pinterest') {
      cachedPinterestPrompt = promptTemplateInput.value;
    } else {
      cachedArticlePrompt = promptTemplateInput.value;
    }

    const currentMode = automationModeSelect.value;
    previousMode = currentMode;

    // Load prompt from cache for the new mode
    if (currentMode === 'pinterest') {
      promptTemplateInput.value = cachedPinterestPrompt;
    } else {
      promptTemplateInput.value = cachedArticlePrompt;
    }

    updateAutomationModeUI();
  });

  // Load Settings
  function loadSettings() {
    chrome.storage.local.get([
      'automationMode', 'sbUrl', 'sbAnonKey', 'sbListName', 'sbBatchLimit',
      'wpUrl', 'wpUsername', 'wpAppPassword', 'wpStatus', 'wpCategoryId',
      'actionDelay', 'concurrency', 'promptTemplate', 'pinterestPromptTemplate', 'testMode',
      'schedStartDate', 'schedPostsPerDay', 'schedHoursStart', 'schedHoursEnd',
      'gptRewrite', 'customGptUrl', 'listicle', 'listicleGptUrl', 'testKeywords'
    ], (items) => {
      chrome.storage.local.set({
        sbUrl: HARDCODED_SB_URL,
        sbAnonKey: HARDCODED_SB_KEY
      });

      automationModeSelect.value = items.automationMode || 'article';
      sbListNameInput.value = items.sbListName || '';
      sbBatchLimitInput.value = items.sbBatchLimit || 100;
      wpUrlInput.value = items.wpUrl || '';
      wpUsernameInput.value = items.wpUsername || '';
      wpAppPasswordInput.value = items.wpAppPassword || '';
      wpStatusSelect.value = items.wpStatus || 'draft';
      wpCategoryIdInput.value = items.wpCategoryId || '';
      actionDelayInput.value = items.actionDelay || 10;
      concurrencySelect.value = items.concurrency || 2;
      
      cachedArticlePrompt = items.promptTemplate || DEFAULT_PROMPT;
      cachedPinterestPrompt = items.pinterestPromptTemplate || DEFAULT_PINTEREST_PROMPT;
      previousMode = items.automationMode || 'article';
      promptTemplateInput.value = (previousMode === 'pinterest') ? cachedPinterestPrompt : cachedArticlePrompt;

      testModeToggle.checked = items.testMode || false;
      testKeywordsInput.value = items.testKeywords || '';
      
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const todayStr = `${yyyy}-${mm}-${dd}`;

      if (!items.schedStartDate) {
        chrome.storage.local.set({ schedStartDate: todayStr });
      }

      schedStartDateInput.value = items.schedStartDate || todayStr;
      schedPostsPerDayInput.value = items.schedPostsPerDay || 3;
      schedHoursStartInput.value = items.schedHoursStart || '08:00';
      schedHoursEndInput.value = items.schedHoursEnd || '22:00';
      
      gptRewriteToggle.checked = items.gptRewrite || false;
      customGptUrlInput.value = items.customGptUrl || '';
      listicleToggle.checked = items.listicle || false;
      listicleGptUrlInput.value = items.listicleGptUrl || '';
      
      toggleRequiredFields(testModeToggle.checked);
      updateScheduleFieldsVisibility();
      updateGptRewriteFieldsVisibility();
      updateListicleFieldsVisibility();
      updateTestModeFieldsVisibility();
      updateAutomationModeUI();
    });
  }

  // Save Settings
  settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();

    if (automationModeSelect.value === 'pinterest') {
      cachedPinterestPrompt = promptTemplateInput.value.trim();
    } else {
      cachedArticlePrompt = promptTemplateInput.value.trim();
    }
    
    const settings = {
      automationMode: automationModeSelect.value,
      sbUrl: HARDCODED_SB_URL,
      sbAnonKey: HARDCODED_SB_KEY,
      sbListName: sbListNameInput.value.trim(),
      sbBatchLimit: parseInt(sbBatchLimitInput.value) || 100,
      wpUrl: wpUrlInput.value.trim(),
      wpUsername: wpUsernameInput.value.trim(),
      wpAppPassword: wpAppPasswordInput.value.trim(),
      wpStatus: wpStatusSelect.value,
      wpCategoryId: wpCategoryIdInput.value.trim(),
      actionDelay: parseInt(actionDelayInput.value) || 10,
      concurrency: parseInt(concurrencySelect.value) || 2,
      promptTemplate: cachedArticlePrompt,
      pinterestPromptTemplate: cachedPinterestPrompt,
      testMode: testModeToggle.checked,
      schedStartDate: schedStartDateInput.value,
      schedPostsPerDay: parseInt(schedPostsPerDayInput.value) || 3,
      schedHoursStart: schedHoursStartInput.value,
      schedHoursEnd: schedHoursEndInput.value,
      gptRewrite: gptRewriteToggle.checked,
      customGptUrl: customGptUrlInput.value.trim(),
      listicle: listicleToggle.checked,
      listicleGptUrl: listicleGptUrlInput.value.trim(),
      testKeywords: testKeywordsInput.value.trim()
    };

    chrome.storage.local.set(settings, () => {
      saveStatusMsg.textContent = 'Settings Saved!';
      saveStatusMsg.classList.add('show');
      
      // Update background with new settings
      chrome.runtime.sendMessage({ action: 'settingsUpdated', settings });

      setTimeout(() => {
        saveStatusMsg.classList.remove('show');
      }, 2000);
    });
  });

  let lastLogCount = 0;

  // Request state from background and update UI
  function updateUIState(state) {
    if (!state) return;

    // Status Badge
    globalStatusBadge.textContent = state.status;
    globalStatusBadge.className = 'status-badge'; // reset
    if (state.status === 'RUNNING') {
      globalStatusBadge.classList.add('active');
    } else if (state.status === 'PAUSED') {
      globalStatusBadge.classList.add('paused');
    }

    // Stats
    const processed = state.stats.processed || 0;
    const remaining = state.stats.remaining || 0;
    const total = state.stats.total || 0;
    
    statProcessed.textContent = processed;
    statRemaining.textContent = remaining;
    statTotal.textContent = total;

    // Progress Bar
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
    progressBarFill.style.width = `${pct}%`;
    progressPercentage.textContent = `${pct}%`;

    // Button states
    if (state.status === 'RUNNING') {
      btnStart.disabled = true;
      btnPause.disabled = false;
      btnStop.disabled = false;
    } else if (state.status === 'PAUSED') {
      btnStart.disabled = false;
      btnPause.disabled = true;
      btnStop.disabled = false;
      btnStart.innerHTML = '<span class="btn-icon">▶</span> Resume';
    } else { // IDLE / FINISHED
      btnStart.disabled = false;
      btnPause.disabled = true;
      btnStop.disabled = true;
      btnStart.innerHTML = '<span class="btn-icon">▶</span> Start';
    }

    // Logs
    if (state.logs && Array.isArray(state.logs)) {
      if (state.logs.length !== lastLogCount) {
        renderLogs(state.logs);
        lastLogCount = state.logs.length;
      }
    }
  }

  function renderLogs(logs) {
    terminalConsole.innerHTML = '';
    if (logs.length === 0) {
      terminalConsole.innerHTML = '<div class="log-line system-log">[System] Console cleared. Ready.</div>';
      return;
    }
    
    logs.forEach(log => {
      const logDiv = document.createElement('div');
      logDiv.className = `log-line ${log.type}-log`;
      logDiv.textContent = log.message;
      terminalConsole.appendChild(logDiv);
    });
    
    // Auto Scroll to bottom
    terminalConsole.scrollTop = terminalConsole.scrollHeight;
  }

  // Poll background state
  function pollBackground() {
    chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
      if (chrome.runtime.lastError) {
        // Background might not be listening yet, or sleep
        return;
      }
      updateUIState(response);
    });
  }

  // Button Action Events
  btnStart.addEventListener('click', () => {
    // Check if configuration is present
    chrome.storage.local.get([
      'automationMode', 'testMode', 'sbUrl', 'sbAnonKey', 'sbListName', 'wpUrl', 'wpUsername', 'wpAppPassword',
      'wpStatus', 'schedStartDate', 'schedPostsPerDay', 'gptRewrite', 'customGptUrl', 'listicle', 'listicleGptUrl', 'testKeywords'
    ], (items) => {
      if (!items.testMode) {
        const isPinterest = items.automationMode === 'pinterest';
        if (isPinterest) {
          if (!items.sbListName) {
            alert('Please fill out the Keyword List Name in settings, or enable Test Mode.');
            tabs[1].click();
            return;
          }
        } else {
          if (!items.sbListName || !items.wpUrl || !items.wpUsername || !items.wpAppPassword) {
            alert('Please fill out all required WordPress and Keyword List settings, or enable Test Mode.');
            tabs[1].click();
            return;
          }
          if (items.wpStatus === 'schedule') {
            if (!items.schedStartDate || !items.schedPostsPerDay) {
              alert('Please configure your Schedule settings (Start Date and Blogs Per Day) under WordPress settings.');
              tabs[1].click();
              return;
            }
          }
          if (items.gptRewrite) {
            if (!items.customGptUrl) {
              alert('Please configure your Custom GPT URL under Automation & Prompt settings.');
              tabs[1].click();
              return;
            }
          }
          if (items.listicle) {
            if (!items.listicleGptUrl) {
              alert('Please configure your Listicle GPT URL under Automation & Prompt settings.');
              tabs[1].click();
              return;
            }
          }
        }
      }
      chrome.runtime.sendMessage({ action: 'start' }, (response) => {
        updateUIState(response);
      });
    });
  });

  btnPause.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'pause' }, (response) => {
      updateUIState(response);
    });
  });

  btnStop.addEventListener('click', () => {
    if (confirm('Are you sure you want to stop the automation process?')) {
      chrome.runtime.sendMessage({ action: 'stop' }, (response) => {
        updateUIState(response);
      });
    }
  });

  btnClearLogs.addEventListener('click', () => {
    lastLogCount = 0;
    chrome.runtime.sendMessage({ action: 'clearLogs' }, (response) => {
      updateUIState(response);
    });
  });

  btnCopyLogs.addEventListener('click', () => {
    const logLines = Array.from(terminalConsole.querySelectorAll('.log-line'))
                         .map(line => line.innerText)
                         .join('\n');
    navigator.clipboard.writeText(logLines)
      .then(() => {
        const originalText = btnCopyLogs.textContent;
        btnCopyLogs.textContent = 'Copied!';
        setTimeout(() => {
          btnCopyLogs.textContent = originalText;
        }, 1500);
      })
      .catch(err => {
        console.error('Failed to copy logs:', err);
        alert('Could not copy logs to clipboard.');
      });
  });

  // Listen for runtime status updates from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'stateUpdated') {
      updateUIState(message.state);
    }
  });

  // Custom Date Picker Logic
  let currentPickerDate = new Date();
  
  function initCalendarPicker() {
    const picker = document.getElementById('calendar-picker');
    const input = document.getElementById('sched-start-date');
    if (!picker || !input) return;
    
    // Toggle calendar on input click
    input.addEventListener('click', (e) => {
      e.stopPropagation();
      picker.classList.toggle('show');
      
      // Parse current value if valid YYYY-MM-DD
      if (input.value) {
        const parsed = new Date(input.value);
        if (!isNaN(parsed.getTime())) {
          currentPickerDate = parsed;
        }
      } else {
        currentPickerDate = new Date();
      }
      
      renderCalendar();
    });
    
    // Close calendar on document click outside
    document.addEventListener('click', (e) => {
      if (!picker.contains(e.target) && e.target !== input) {
        picker.classList.remove('show');
      }
    });
    
    function renderCalendar() {
      picker.innerHTML = '';
      
      const year = currentPickerDate.getFullYear();
      const month = currentPickerDate.getMonth();
      
      // Header
      const header = document.createElement('div');
      header.className = 'calendar-header';
      
      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.textContent = '◀';
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentPickerDate.setMonth(month - 1);
        renderCalendar();
      });
      
      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.textContent = '▶';
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentPickerDate.setMonth(month + 1);
        renderCalendar();
      });
      
      const title = document.createElement('div');
      title.className = 'calendar-month-title';
      const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      title.textContent = `${monthNames[month]} ${year}`;
      
      header.appendChild(prevBtn);
      header.appendChild(title);
      header.appendChild(nextBtn);
      picker.appendChild(header);
      
      // Weekdays
      const weekdays = document.createElement('div');
      weekdays.className = 'calendar-weekdays';
      const dayNames = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
      dayNames.forEach(name => {
        const dayEl = document.createElement('div');
        dayEl.textContent = name;
        weekdays.appendChild(dayEl);
      });
      picker.appendChild(weekdays);
      
      // Days grid
      const daysContainer = document.createElement('div');
      daysContainer.className = 'calendar-days';
      
      // First day of month (0 = Sunday, 1 = Monday, etc.)
      const firstDayDate = new Date(year, month, 1);
      let firstDayIndex = firstDayDate.getDay();
      // Adjust Sunday to index 6, Monday to index 0
      firstDayIndex = firstDayIndex === 0 ? 6 : firstDayIndex - 1;
      
      const totalDays = new Date(year, month + 1, 0).getDate();
      
      // Empty cells before first day
      for (let i = 0; i < firstDayIndex; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day-cell empty';
        daysContainer.appendChild(emptyCell);
      }
      
      // Days cells
      for (let day = 1; day <= totalDays; day++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day-cell';
        cell.textContent = day;
        
        // Check if selected
        const currentSelected = input.value ? new Date(input.value) : null;
        if (currentSelected &&
            currentSelected.getFullYear() === year &&
            currentSelected.getMonth() === month &&
            currentSelected.getDate() === day) {
          cell.classList.add('selected');
        }
        
        cell.addEventListener('click', (e) => {
          e.stopPropagation();
          // Format as YYYY-MM-DD
          const formatMonth = String(month + 1).padStart(2, '0');
          const formatDay = String(day).padStart(2, '0');
          input.value = `${year}-${formatMonth}-${formatDay}`;
          picker.classList.remove('show');
          
          // Dispatch change event so listener saves it
          input.dispatchEvent(new Event('change'));
        });
        
        daysContainer.appendChild(cell);
      }
      
      picker.appendChild(daysContainer);
    }
  }

  // Initialize
  initCalendarPicker();
  loadSettings();
  pollBackground();
  // Poll every 1s for solid real-time state sync when popup is open
  setInterval(pollBackground, 1000);
});
