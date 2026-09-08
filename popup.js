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
    const isArticle = automationModeSelect.value === 'article';
    const isBook = automationModeSelect.value === 'book';
    const inputs = [
      sbListNameInput, sbBatchLimitInput
    ];
    if (isArticle || isBook) {
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
        if (isTestMode || wpStatusSelect.value !== 'schedule' || (!isArticle && !isBook)) {
          input.removeAttribute('required');
        } else {
          input.setAttribute('required', 'required');
        }
      }
    });

    gptInputs.forEach(input => {
      if (input) {
        if (isTestMode || !isArticle || !gptRewriteToggle.checked) {
          input.removeAttribute('required');
        } else {
          input.setAttribute('required', 'required');
        }
      }
    });

    listicleInputs.forEach(input => {
      if (input) {
        if (isTestMode || !isArticle || !listicleToggle.checked) {
          input.removeAttribute('required');
        } else {
          input.setAttribute('required', 'required');
        }
      }
    });

    if (testKeywordsInput) {
      if (isTestMode) {
        testKeywordsInput.setAttribute('required', 'required');
      } else {
        testKeywordsInput.removeAttribute('required');
      }
    }
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
- 400–480 characters (Strict maximum: Must NEVER exceed 500 characters).
- Naturally incorporate 4–5 relevant keywords/long-tail phrases (from the keyword itself and, where applicable, the filtered annotations) — no forced or unnatural insertion.
- Must read naturally, like it's written for humans first, search engines second.

Output strictly in this JSON format, with no extra text before or after:
{
  "title": "Some title",
  "description": "Some description"
}`;

  const DEFAULT_BOOK_PROMPT = `KEYWORD: {{KEYWORD}}

You are an expert book journalist, SEO strategist and fact-checker.

Research and write a complete, original, SEO-friendly book article based only on the supplied keyword. Do not ask me for additional information. Infer the search intent, audience, article type, suitable title, number of books, headings, related keywords and appropriate length.

RESEARCH

- Research before writing.
- Verify book facts using official author pages, publishers, Open Library or Google Books.
- Analyze reputable book blogs and relevant Reddit discussions to understand reader opinions, recurring recommendations, complaints, tropes and questions.
- Use blogs and Reddit for insight only. Never copy their wording, ordering or article structure.
- Paraphrase community opinions without usernames.
- Never invent titles, authors, ISBNs, publication details, series order, tropes or content warnings.
- Return null when an ISBN or other detail cannot be verified.
- Never claim you personally read a book.
- Keep all descriptions spoiler-free.
- Do not include changing Goodreads ratings.

SEARCH INTENT

- Determine whether the keyword requires a listicle, individual review, comparison, reading-order guide, upcoming-release article or another format.
- If the keyword contains a number, use that exact number.
- Otherwise, select an appropriate number based on research and available high-quality recommendations, normally 8–15.
- Include only books that closely satisfy the keyword.

SEO

- Create a natural H1 title containing the primary keyword.
- Generate a 50–60 character SEO title.
- Generate a 145–160 character meta description.
- Generate a clean lowercase slug.
- Generate a 25–35 word excerpt.
- Identify related secondary keywords automatically.
- Use one H1 only.
- Use H2 for major sections and H3 for individual book titles and FAQ questions.
- Use short paragraphs of 2–4 sentences.
- Avoid keyword stuffing.
- Include 3–5 useful FAQ questions based on actual search and community research.
- Suggest relevant internal-link opportunities.
- Write enough content to satisfy the query completely without padding.

BOOK SECTIONS

For every recommended book provide:

- Exact title
- Exact author
- Series and series position when verified
- Verified ISBN-13 when available
- Open Library lookup query
- Approximately 120–180 words of original, spoiler-free commentary
- Premise
- Fantasy elements
- Romance style or important tropes
- Tone
- Ideal reader
- Relevant content notes only when verified
- Goodreads search query
- Amazon search query
- Research source URLs

Each Ronin Book section must follow this vertical order:

1. Large centered book cover
2. H3 book title
3. Author
4. Description
5. Goodreads and Amazon buttons in one row

Never add labels such as “Book 1,” “Book 2,” “Featured Book” or “Recommendation 1.”

WRITING QUALITY

- Write in a knowledgeable, natural and direct editorial voice.
- Provide original analysis instead of rewriting publisher descriptions.
- Explain why every book belongs in the article.
- Mention meaningful differences between recommendations.
- Include reasonable reader-fit limitations where useful.
- Avoid spoilers, filler and exaggerated claims.
- Avoid phrases such as “delve into,” “embark on,” “ultimate guide,” “without further ado” and “whether you’re a seasoned reader.”
- Do not copy sentences from any source.

OUTPUT

Return valid JSON only, without Markdown fences or additional commentary:

{
  "title": "",
  "seo_title": "",
  "slug": "",
  "meta_description": "",
  "excerpt": "",
  "primary_keyword": "",
  "secondary_keywords": [],
  "category": "Book Reviews",
  "affiliate_disclosure": "",
  "introduction": ["", ""],
  "topic_explanation": {
    "heading": "",
    "paragraphs": ["", ""]
  },
  "recommendations_heading": "",
  "books": [
    {
      "title": "",
      "author": "",
      "series": null,
      "series_position": null,
      "isbn13": null,
      "open_library_query": "",
      "description": ["", ""],
      "tropes": [],
      "fantasy_elements": [],
      "romance_style": "",
      "tone": "",
      "ideal_reader": "",
      "content_notes": null,
      "goodreads_query": "",
      "amazon_query": "",
      "research_source_urls": []
    }
  ],
  "selection_help": {
    "heading": "",
    "paragraphs": ["", ""]
  },
  "faq": [
    {
      "question": "",
      "answer": ""
    }
  ],
  "conclusion": [""],
  "internal_link_suggestions": [
    {
      "anchor_text": "",
      "target_topic": ""
    }
  ],
  "sources": [
    {
      "source_name": "",
      "source_url": "",
      "source_type": "official|publisher|book_database|blog|reddit",
      "used_for": ""
    }
  ]
}

Before returning the result, verify that all facts are supported, the JSON is valid, the article matches the keyword’s intent, no required books are missing and no source language has been copied.`;

  let cachedArticlePrompt = DEFAULT_PROMPT;
  let cachedPinterestPrompt = DEFAULT_PINTEREST_PROMPT;
  let cachedBookPrompt = DEFAULT_BOOK_PROMPT;
  let previousMode = 'article';

  function updateAutomationModeUI() {
    const isArticle = automationModeSelect.value === 'article';
    const isBook = automationModeSelect.value === 'book';
    const wpAccordion = document.getElementById('wordpress-accordion');
    const gptSwitch = document.getElementById('gpt-rewrite-switch-group');
    const listicleSwitch = document.getElementById('listicle-switch-group');

    if (wpAccordion) {
      wpAccordion.style.display = (isArticle || isBook) ? 'block' : 'none';
      if (isBook && !wpUrlInput.value) {
        wpUrlInput.value = 'https://bookspect.com';
      }
    }

    if (isArticle) {
      if (gptSwitch) gptSwitch.style.display = 'block';
      if (listicleSwitch) listicleSwitch.style.display = 'block';

      updateGptRewriteFieldsVisibility();
      updateListicleFieldsVisibility();
    } else {
      if (gptSwitch) gptSwitch.style.display = 'none';
      if (gptRewriteFields) gptRewriteFields.classList.remove('show');
      if (listicleSwitch) listicleSwitch.style.display = 'none';
      if (listicleFields) listicleFields.classList.remove('show');
    }
    toggleRequiredFields(testModeToggle.checked);
  }

  automationModeSelect.addEventListener('change', () => {
    // Cache the current prompt to the old mode's key
    if (previousMode === 'pinterest') {
      cachedPinterestPrompt = promptTemplateInput.value;
    } else if (previousMode === 'book') {
      cachedBookPrompt = promptTemplateInput.value;
    } else {
      cachedArticlePrompt = promptTemplateInput.value;
    }

    const currentMode = automationModeSelect.value;
    previousMode = currentMode;

    // Load prompt from cache for the new mode
    if (currentMode === 'pinterest') {
      promptTemplateInput.value = cachedPinterestPrompt;
    } else if (currentMode === 'book') {
      promptTemplateInput.value = cachedBookPrompt;
    } else {
      promptTemplateInput.value = cachedArticlePrompt;
    }

    updateAutomationModeUI();
  });

  promptTemplateInput.addEventListener('input', () => {
    if (automationModeSelect.value === 'pinterest') {
      cachedPinterestPrompt = promptTemplateInput.value;
    } else if (automationModeSelect.value === 'book') {
      cachedBookPrompt = promptTemplateInput.value;
    } else {
      cachedArticlePrompt = promptTemplateInput.value;
    }
  });

  // Load Settings
  function loadSettings() {
    chrome.storage.local.get([
      'automationMode', 'sbUrl', 'sbAnonKey', 'sbListName', 'sbBatchLimit',
      'wpUrl', 'wpUsername', 'wpAppPassword', 'wpStatus', 'wpCategoryId',
      'actionDelay', 'concurrency', 'promptTemplate', 'pinterestPromptTemplate', 'bookPromptTemplate', 'testMode',
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
      cachedBookPrompt = items.bookPromptTemplate || DEFAULT_BOOK_PROMPT;
      previousMode = items.automationMode || 'article';
      if (previousMode === 'pinterest') {
        promptTemplateInput.value = cachedPinterestPrompt;
      } else if (previousMode === 'book') {
        promptTemplateInput.value = cachedBookPrompt;
      } else {
        promptTemplateInput.value = cachedArticlePrompt;
      }

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
    } else if (automationModeSelect.value === 'book') {
      cachedBookPrompt = promptTemplateInput.value.trim();
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
      bookPromptTemplate: cachedBookPrompt,
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
      if (items.testMode) {
        if (!items.testKeywords || !items.testKeywords.trim()) {
          alert('Test Mode is enabled, but Test Keywords is empty. Add Test Keywords or disable Test Mode to fetch the selected Supabase list.');
          tabs[1].click();
          return;
        }
      } else {
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
          if (items.automationMode === 'article' && items.gptRewrite) {
            if (!items.customGptUrl) {
              alert('Please configure your Custom GPT URL under Automation & Prompt settings.');
              tabs[1].click();
              return;
            }
          }
          if (items.automationMode === 'article' && items.listicle) {
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
