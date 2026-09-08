// Background Service Worker

let state = {
  status: 'IDLE', // IDLE, RUNNING, PAUSED, COMPLETED
  stats: {
    processed: 0,
    remaining: 0,
    total: 0
  },
  queue: [],
  scheduleDates: [], // Pre-calculated future dates for scheduling
  currentIndex: 0,
  failedKeywords: [],
  consecutiveFailures: 0,
  isRetryPhase: false,
  activeTabIds: [],
  logs: []
};

// Keepalive alarms to prevent service worker from sleeping
chrome.alarms.create('keepAlive', { periodInMinutes: 0.25 }); // every 15s
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    console.log('[AutoAgent] Keepalive heartbeat.');
  }
});

// Load state on startup
loadState(() => {
  addLog('system', 'Service worker initialized.');
  if (state.status === 'RUNNING') {
    addLog('warning', 'Service worker restarted during an active run. Recovering automatically from pending/failed Supabase items.');
    cleanupAllActiveTabs();
    state.queue = [];
    state.scheduleDates = [];
    state.currentIndex = 0;
    state.stats = { processed: 0, remaining: 0, total: 0 };
    state.failedKeywords = [];
    state.consecutiveFailures = 0;
    state.isRetryPhase = false;
    saveState();
    broadcastState();
    setTimeout(() => runStateMachine(), 0);
  }
});

// Watch for manual tab closure
chrome.tabs.onRemoved.addListener((tabId) => {
  if (state.activeTabIds && state.activeTabIds.includes(tabId)) {
    state.activeTabIds = state.activeTabIds.filter(id => id !== tabId);
    saveState();
  }
});

// Helper for delaying execution
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Log builder
function addLog(type, message) {
  const time = new Date().toLocaleTimeString();
  const logItem = { time, type, message: `[${time}] ${message}` };
  if (!state.logs) state.logs = [];
  state.logs.push(logItem);
  if (state.logs.length > 200) {
    state.logs.shift();
  }
  console.log(`[${type.toUpperCase()}] ${message}`);
}

// State persist
function saveState() {
  chrome.storage.local.set({ extensionState: state });
}

function loadState(callback) {
  chrome.storage.local.get(['extensionState'], (result) => {
    if (result.extensionState) {
      state = result.extensionState;
      if (!state.logs) state.logs = [];
      if (!state.stats) state.stats = { processed: 0, remaining: 0, total: 0 };
      if (!Number.isFinite(state.consecutiveFailures)) state.consecutiveFailures = 0;
    }
    if (callback) callback();
  });
}

function broadcastState() {
  chrome.runtime.sendMessage({ action: 'stateUpdated', state }).catch(() => {
    // Popup closed, ignore error
  });
}

// Helper to get today's date in YYYY-MM-DD format
function getTodayStr() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const HARDCODED_SB_URL = 'https://wgsqlctbgflkfnjkcubb.supabase.co';
const HARDCODED_SB_KEY = 'sb_publishable_Qz9vTBAZcjaLYAJYPbDAHA_jFOMGnJG';

// Retrieve settings from local storage
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([
      'automationMode', 'sbUrl', 'sbAnonKey', 'sbListName', 'sbBatchLimit',
      'wpUrl', 'wpUsername', 'wpAppPassword', 'wpStatus', 'wpCategoryId',
      'actionDelay', 'concurrency', 'promptTemplate', 'pinterestPromptTemplate', 'bookPromptTemplate', 'testMode',
      'schedStartDate', 'schedPostsPerDay', 'schedHoursStart', 'schedHoursEnd',
      'gptRewrite', 'customGptUrl', 'listicle', 'listicleGptUrl', 'testKeywords'
    ], (items) => {
      resolve({
        automationMode: items.automationMode || 'article',
        sbUrl: HARDCODED_SB_URL,
        sbAnonKey: HARDCODED_SB_KEY,
        sbListName: items.sbListName || '',
        sbBatchLimit: parseInt(items.sbBatchLimit) || 10,
        wpUrl: items.wpUrl || '',
        wpUsername: items.wpUsername || '',
        wpAppPassword: items.wpAppPassword || '',
        wpStatus: items.wpStatus || 'draft',
        wpCategoryId: items.wpCategoryId || '',
        actionDelay: parseInt(items.actionDelay) || 10,
        concurrency: Math.max(1, Math.min(parseInt(items.concurrency) || 2, 3)),
        promptTemplate: items.promptTemplate || 'Write a 1500-word highly engaging SEO article about {keyword} containing headings and a summary.',
        pinterestPromptTemplate: items.pinterestPromptTemplate || `I need an engaging, SEO-optimized Pinterest title and description for the following keyword: "{keyword}"

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
}`,
        bookPromptTemplate: items.bookPromptTemplate || `Write a comprehensive, engaging book chapter/guide about {keyword}.
Structure the text into logical sections with clear descriptive titles on their own lines.
Do NOT use markdown headers (#, ##, ###), markdown bold (**), or asterisks. Write in clean, formatted plain text with standard paragraphs.`,
        testMode: items.testMode || false,
        schedStartDate: items.schedStartDate || getTodayStr(),
        schedPostsPerDay: parseInt(items.schedPostsPerDay) || 3,
        schedHoursStart: items.schedHoursStart || '08:00',
        schedHoursEnd: items.schedHoursEnd || '22:00',
        gptRewrite: items.gptRewrite || false,
        customGptUrl: items.customGptUrl || '',
        listicle: items.listicle || false,
        listicleGptUrl: items.listicleGptUrl || '',
        testKeywords: items.testKeywords || ''
      });
    });
  });
}

// URL normalizer
function normalizeWpUrl(url) {
  let clean = url.trim();
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    clean = 'https://' + clean;
  }
  if (clean.endsWith('/')) {
    clean = clean.slice(0, -1);
  }
  return clean;
}

// Parse Grok Markdown Output (extract title, split intro/body)
function parseGrokOutput(fullText) {
  let title = '';
  let contentText = fullText || '';

  // Extract H1 (e.g. "# My Title")
  const h1Match = contentText.match(/^(?:#\s+)(.+)$/m);
  if (h1Match) {
    title = h1Match[1].trim();
    // Remove the title line from content to avoid duplicate headers
    contentText = contentText.replace(h1Match[0], '').trim();
  }

  // Split remainder into intro and body
  const marker = /<!--INTRO_END-->/;
  let intro = '';
  let body = '';

  if (marker.test(contentText)) {
    const parts = contentText.split(marker);
    intro = parts[0].trim();
    body = parts.slice(1).join('').trim();
  } else {
    // Fallback: Split at first subheading (## or ###)
    const idx = contentText.search(/\n#{2,3}\s/);
    if (idx === -1) {
      // Split at the first double newline (paragraph boundary)
      const pIdx = contentText.indexOf('\n\n');
      if (pIdx === -1) {
        intro = contentText;
        body = '';
      } else {
        intro = contentText.slice(0, pIdx).trim();
        body = contentText.slice(pIdx).trim();
      }
    } else {
      intro = contentText.slice(0, idx).trim();
      body = contentText.slice(idx).trim();
    }
  }

  return { title, intro, body };
}

// Split HTML content at marker or first subheading tag
function splitHtmlContent(html) {
  const marker = /<!--INTRO_END-->/;
  if (marker.test(html)) {
    const parts = html.split(marker);
    return {
      intro: parts[0].trim(),
      body: parts.slice(1).join('').trim()
    };
  }
  
  // Fallback: Split at first h2 or h3 tag
  const idx = html.search(/<(h2|h3)[^>]*>/i);
  if (idx === -1) {
    // Split at first </p> tag
    const pIdx = html.indexOf('</p>');
    if (pIdx === -1) {
      return { intro: html, body: '' };
    } else {
      const splitPoint = pIdx + 4;
      return {
        intro: html.slice(0, splitPoint).trim(),
        body: html.slice(splitPoint).trim()
      };
    }
  } else {
    return {
      intro: html.slice(0, idx).trim(),
      body: html.slice(idx).trim()
    };
  }
}

// Parse Grok HTML Output (extract title, split intro/body)
function parseHtmlGrokOutput(html) {
  let title = '';
  let contentHtml = html || '';

  // Extract first h1
  const h1Match = contentHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    title = h1Match[1].replace(/<[^>]+>/g, '').trim();
    contentHtml = contentHtml.replace(h1Match[0], '').trim();
  }

  const split = splitHtmlContent(contentHtml);
  return { title, intro: split.intro, body: split.body };
}

// Convert copied Markdown into native WordPress/Gutenberg block markup.
function markdownToHtml(md) {
  if (!md) return '';

  const normalizedMarkdown = md
    .replace(/&#x20;|&#32;|&nbsp;/gi, ' ')
    .replace(/^[\t ]*\\[\t ]*$/gm, '')
    .replace(/\r\n?/g, '\n');
  const lines = normalizedMarkdown.split('\n');
  const blocks = [];
  const isTableSeparator = (line) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  const isBlockStart = (line, nextLine = '') => {
    const trimmed = line.trim();
    return !trimmed ||
      /^#{1,6}\s+/.test(trimmed) ||
      /^```/.test(trimmed) ||
      /^>\s?/.test(trimmed) ||
      /^[-*+]\s+/.test(trimmed) ||
      /^\d+[.)]\s+/.test(trimmed) ||
      /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed) ||
      (trimmed.includes('|') && isTableSeparator(nextLine));
  };

  const splitTableRow = (line) => line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.replace(/\\\|/g, '|').trim());

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      i++;
      continue;
    }

    // Fenced code block.
    if (/^```/.test(line)) {
      const language = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      const languageClass = language ? ` class="language-${escapeHtml(language)}"` : '';
      blocks.push(`<!-- wp:code -->\n<pre class="wp-block-code"><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>\n<!-- /wp:code -->`);
      continue;
    }

    // ATX headings (# through ######).
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const attrs = level === 2 ? '' : ` {"level":${level}}`;
      blocks.push(`<!-- wp:heading${attrs} -->\n<h${level} class="wp-block-heading">${parseInlineMarkdown(headingMatch[2])}</h${level}>\n<!-- /wp:heading -->`);
      i++;
      continue;
    }

    // Markdown table.
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const headHtml = headers.map(cell => `<th>${parseInlineMarkdown(cell)}</th>`).join('');
      const bodyHtml = rows.map(row => `<tr>${row.map(cell => `<td>${parseInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('');
      blocks.push(`<!-- wp:table -->\n<figure class="wp-block-table"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></figure>\n<!-- /wp:table -->`);
      continue;
    }

    // Ordered or unordered list.
    const unordered = /^[-*+]\s+/.test(line);
    const ordered = /^\d+[.)]\s+/.test(line);
    if (unordered || ordered) {
      const listTag = ordered ? 'ol' : 'ul';
      const items = [];
      const itemPattern = ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/;
      while (i < lines.length) {
        const itemMatch = lines[i].trim().match(itemPattern);
        if (!itemMatch) break;
        items.push(`<li>${parseInlineMarkdown(itemMatch[1])}</li>`);
        i++;
      }
      const attrs = ordered ? ' {"ordered":true}' : '';
      blocks.push(`<!-- wp:list${attrs} -->\n<${listTag} class="wp-block-list">${items.join('')}</${listTag}>\n<!-- /wp:list -->`);
      continue;
    }

    // Blockquote.
    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push(`<!-- wp:quote -->\n<blockquote class="wp-block-quote"><p>${parseInlineMarkdown(quoteLines.join('<br>'))}</p></blockquote>\n<!-- /wp:quote -->`);
      continue;
    }

    // Horizontal rule.
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
      blocks.push('<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->');
      i++;
      continue;
    }

    // Join wrapped lines into a single paragraph until the next blank/block.
    const paragraphLines = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i], lines[i + 1] || '')) {
      paragraphLines.push(lines[i].trim());
      i++;
    }
    const paragraph = paragraphLines.join(' ');
    blocks.push(`<!-- wp:paragraph -->\n<p>${parseInlineMarkdown(paragraph)}</p>\n<!-- /wp:paragraph -->`);
  }

  const html = blocks.join('\n\n');
  validateWordPressFormatting(md, html);
  return html;
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseInlineMarkdown(text) {
  const codeTokens = [];
  let html = String(text || '')
    .replace(/\\([\\`*_[\]{}()#+.!|>-])/g, '$1')
    .replace(/`([^`]+)`/g, (_, code) => {
    const token = `\u0000CODE${codeTokens.length}\u0000`;
    codeTokens.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  html = escapeHtml(html);
  html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1">');
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  html = html.replace(/  $/g, '<br>');
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => codeTokens[Number(index)] || '');
  return html;
}

// Convert Markdown/text into clean, flattened plain text with all Markdown syntax stripped.
function flattenMarkdownToPlainText(md) {
  if (!md) return '';

  let text = md
    .replace(/&#x20;|&#32;|&nbsp;/gi, ' ')
    .replace(/\r\n?/g, '\n');

  // Strip fenced code blocks (keep the code content as plain text)
  text = text.replace(/```[a-z0-9_-]*\n([\s\S]*?)```/gi, '$1');

  // Strip inline code `code`
  text = text.replace(/`([^`]+)`/g, '$1');

  // Strip images ![alt](url) -> ''
  text = text.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');

  // Convert links [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

  // Strip markdown headers (# ... ######)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '$1');

  // Strip bold & italic markers (**text**, __text__, *text*, _text_)
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
  text = text.replace(/(\*|_)(.*?)\1/g, '$2');

  // Strip blockquote markers (> )
  text = text.replace(/^>\s?/gm, '');

  // Clean bullet list markers (- , * , + ) to clean bullet lines
  text = text.replace(/^[\t ]*[-*+]\s+/gm, '• ');

  // Clean numbered lists
  text = text.replace(/^[\t ]*(\d+)[.)]\s+/gm, '$1. ');

  // Strip horizontal rules (---, ***, ___)
  text = text.replace(/^(?:-{3,}|\*{3,}|_{3,})$/gm, '');

  // Strip any raw HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Normalize multiple consecutive blank lines to at most two newlines (one blank line between paragraphs)
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

function validateWordPressFormatting(markdown, html) {
  const expectedH2 = (markdown.match(/^##\s+/gm) || []).length;
  const expectedH3 = (markdown.match(/^###\s+/gm) || []).length;
  const actualH2 = (html.match(/<h2\b/g) || []).length;
  const actualH3 = (html.match(/<h3\b/g) || []).length;
  const expectsTable = /^\s*\|?.+\|.+$/m.test(markdown) && /^\s*\|?\s*:?-{3,}/m.test(markdown);

  if (actualH2 !== expectedH2 || actualH3 !== expectedH3) {
    throw new Error(`Markdown formatting conversion failed: expected ${expectedH2} H2/${expectedH3} H3 headings, generated ${actualH2} H2/${actualH3} H3 headings.`);
  }
  if (expectsTable && !/<table\b/.test(html)) {
    throw new Error('Markdown formatting conversion failed: a Markdown table was not converted to HTML.');
  }
}

// Format local date to WordPress REST API compatible format: YYYY-MM-DDTHH:MM:SS
function formatLocalISO(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;
}

// Generate randomized timestamps distributed throughout active hours of the day
function generateScheduleDates(totalKeywords, settings) {
  const dates = [];
  const postsPerDay = settings.schedPostsPerDay || 3;
  const startParts = (settings.schedHoursStart || '08:00').split(':');
  const endParts = (settings.schedHoursEnd || '22:00').split(':');
  const startMin = parseInt(startParts[0]) * 60 + parseInt(startParts[1] || 0);
  const endMin = parseInt(endParts[0]) * 60 + parseInt(endParts[1] || 0);
  const rangeMin = Math.max(60, endMin - startMin); // Minimum 1 hr window

  // If base date not configured, default to today
  let baseDate = settings.schedStartDate ? new Date(settings.schedStartDate + 'T00:00:00') : new Date();

  let currentIdx = 0;
  while (currentIdx < totalKeywords) {
    const remaining = totalKeywords - currentIdx;
    const postsOnThisDay = Math.min(postsPerDay, remaining);
    
    // Generate K random minute offsets within the active window range
    const offsets = [];
    for (let i = 0; i < postsOnThisDay; i++) {
      offsets.push(Math.floor(Math.random() * rangeMin));
    }
    // Sort ascending so scheduling orders chronologically throughout each day
    offsets.sort((a, b) => a - b);
    
    // Day offset calculation
    const dayOffset = Math.floor(currentIdx / postsPerDay);
    const dayDate = new Date(baseDate.getTime());
    dayDate.setDate(baseDate.getDate() + dayOffset);

    for (let i = 0; i < postsOnThisDay; i++) {
      const timeInMin = startMin + offsets[i];
      const hr = Math.floor(timeInMin / 60);
      const mn = Math.floor(timeInMin % 60);
      
      const targetDate = new Date(dayDate.getTime());
      targetDate.setHours(hr, mn, 0, 0);
      dates.push(formatLocalISO(targetDate));
    }
    currentIdx += postsOnThisDay;
  }
  return dates;
}

// Open a new tab
function createTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        registerActiveTab(tab.id);
        resolve(tab);
      }
    });
  });
}

function registerActiveTab(tabId) {
  if (!state.activeTabIds) state.activeTabIds = [];
  if (!state.activeTabIds.includes(tabId)) {
    state.activeTabIds.push(tabId);
    saveState();
  }
}

function unregisterActiveTab(tabId) {
  if (!state.activeTabIds) state.activeTabIds = [];
  state.activeTabIds = state.activeTabIds.filter(id => id !== tabId);
  saveState();
}

// Helper to close a specific automation tab
function cleanupTab(tabId) {
  if (tabId) {
    unregisterActiveTab(tabId);
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        // Swallowing error if already closed
      }
    });
  }
}

// Helper to close all active automation tabs across all workers
function cleanupAllActiveTabs() {
  if (state.activeTabIds && state.activeTabIds.length > 0) {
    const tabsToClose = [...state.activeTabIds];
    state.activeTabIds = [];
    saveState();
    for (const tId of tabsToClose) {
      chrome.tabs.get(tId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        const tabUrl = tab.url || '';
        if (!/^https:\/\/(?:www\.)?(?:grok\.com|chatgpt\.com)\//i.test(tabUrl)) return;
        chrome.tabs.remove(tId, () => {
          if (chrome.runtime.lastError) {}
        });
      });
    }
  }
}

// Message sender to Tab content script
function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ status: 'error', message: chrome.runtime.lastError.message });
      } else {
        resolve(response);
      }
    });
  });
}

// Clipboard access requires the target document to own browser focus. Serialize all
// Copy-button extraction so parallel workers cannot steal focus from each other.
let clipboardExtractionQueue = Promise.resolve();

function focusTabForClipboard(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        reject(new Error(chrome.runtime.lastError?.message || 'Clipboard tab no longer exists.'));
        return;
      }

      chrome.windows.update(tab.windowId, { focused: true }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(`Could not focus browser window: ${chrome.runtime.lastError.message}`));
          return;
        }

        chrome.tabs.update(tabId, { active: true }, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(`Could not activate clipboard tab: ${chrome.runtime.lastError.message}`));
            return;
          }
          setTimeout(resolve, 800);
        });
      });
    });
  });
}

function sendClipboardMessageToTab(tabId, message) {
  const extraction = clipboardExtractionQueue.then(async () => {
    await focusTabForClipboard(tabId);
    return await sendMessageToTab(tabId, message);
  });

  // Keep the queue usable after an individual extraction error.
  clipboardExtractionQueue = extraction.catch(() => {});
  return extraction;
}

// Promise timeout wrapper
function withTimeout(promise, ms, timeoutMessage = 'Timeout exceeded.') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, ms);
  });
  return Promise.race([
    promise.then(res => {
      clearTimeout(timeoutId);
      return res;
    }),
    timeoutPromise
  ]);
}

// Verify content script is loaded
function waitForContentScriptReady(tabId) {
  return new Promise((resolve) => {
    let attempts = 0;
    const maxAttempts = 600; // 10 minutes max wait
    
    const interval = setInterval(() => {
      attempts++;
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
        if (chrome.runtime.lastError) {
          if (attempts >= maxAttempts) {
            clearInterval(interval);
            resolve(false);
          }
          return;
        }
        if (response && response.status === 'pong') {
          clearInterval(interval);
          resolve(true);
        }
      });
    }, 1000);
  });
}
// Poll tab until standard generation is complete
async function pollGenerationComplete(tabId, timeoutMs = 600000) {
  const startTime = Date.now();
  while (true) {
    await delay(2000);
    
    if (Date.now() - startTime > timeoutMs) {
      throw new Error('Grok generation timed out after 10 minutes.');
    }
    
    const check = await sendMessageToTab(tabId, { action: 'checkGenerationStatus' });
    if (check.status === 'error') {
      throw new Error(check.message || 'Error occurred during generation.');
    }
    if (check.isDone) {
      return;
    }
  }
}

// Poll tab until Custom GPT intro/listicle is complete
async function pollGptIntroComplete(tabId, timeoutMs = 600000) {
  const startTime = Date.now();
  while (true) {
    await delay(2000);
    
    if (Date.now() - startTime > timeoutMs) {
      throw new Error('Custom GPT intro generation timed out after 10 minutes.');
    }
    
    const check = await sendMessageToTab(tabId, { action: 'checkGptIntroStatus' });
    if (check.status === 'error') {
      throw new Error(check.message || 'Error occurred during Custom GPT generation.');
    }
    if (check.isDone) {
      return;
    }
  }
}

// --- API FETCH FUNCTIONS ---

// Fetch Supabase List ID
async function fetchListId(settings) {
  const sbUrl = settings.sbUrl.replace(/\/$/, '');
  const endpoint = `${sbUrl}/rest/v1/pin_kw_lists?name=eq.${encodeURIComponent(settings.sbListName)}&select=id`;
  
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'apikey': settings.sbAnonKey,
      'Authorization': `Bearer ${settings.sbAnonKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed: HTTP ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (data && data.length > 0) {
    return data[0].id;
  }
  return null;
}

// Fetch keywords that still need processing, including previously failed items.
async function fetchPendingKeywords(settings, listId) {
  const sbUrl = settings.sbUrl.replace(/\/$/, '');
  const endpoint = `${sbUrl}/rest/v1/pin_keywords?status=in.(pending,failed)&kw_list_id=eq.${listId}&limit=${settings.sbBatchLimit}&select=id,keyword`;
  
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'apikey': settings.sbAnonKey,
      'Authorization': `Bearer ${settings.sbAnonKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed: HTTP ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

// Update Supabase Status
async function updateKeywordStatus(settings, kwId, status) {
  const sbUrl = settings.sbUrl.replace(/\/$/, '');
  const endpoint = `${sbUrl}/rest/v1/pin_keywords?id=eq.${encodeURIComponent(kwId)}&select=id,status`;
  
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      'apikey': settings.sbAnonKey,
      'Authorization': `Bearer ${settings.sbAnonKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ status })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase patch failed: HTTP ${response.status} ${response.statusText}. ${errorText.substring(0, 300)}`);
  }

  const updatedRows = await response.json();
  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    throw new Error(`Supabase status update affected no rows for keyword ID ${kwId}.`);
  }

  return updatedRows[0];
}

// Dynamic database table column inspector
async function inspectTableSchema(settings, tableName) {
  try {
    const sbUrl = settings.sbUrl.replace(/\/$/, '');
    const response = await fetch(`${sbUrl}/rest/v1/?apikey=${settings.sbAnonKey}`, {
      method: 'GET',
      headers: {
        'apikey': settings.sbAnonKey,
        'Authorization': `Bearer ${settings.sbAnonKey}`
      }
    });
    if (response.ok) {
      const swagger = await response.json();
      if (swagger && swagger.definitions && swagger.definitions[tableName]) {
        const properties = swagger.definitions[tableName].properties;
        return Object.keys(properties || {});
      }
    }
  } catch (e) {
    console.error('Failed to inspect table schema:', e);
  }
  return null;
}

// Update Supabase Keyword Image Status
async function updateKeywordImageStatus(settings, kwId, imageStatus) {
  const sbUrl = settings.sbUrl.replace(/\/$/, '');
  const endpoint = `${sbUrl}/rest/v1/pin_keywords?id=eq.${kwId}`;
  
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      'apikey': settings.sbAnonKey,
      'Authorization': `Bearer ${settings.sbAnonKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ image_status: imageStatus })
  });

  if (!response.ok) {
    throw new Error(`Supabase patch image_status failed: HTTP ${response.status} ${response.statusText}`);
  }
}

// Fetch Grok Keywords directly from Supabase pin_keywords where image_status = 'pending'
async function fetchGrokKeywords(settings, listId) {
  const sbUrl = settings.sbUrl.replace(/\/$/, '');
  const endpoint = `${sbUrl}/rest/v1/pin_keywords?kw_list_id=eq.${listId}&limit=${settings.sbBatchLimit}&select=id,keyword,annotation_tags,pin_images(slot_index,wp_image_url,title,description)`;
  
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'apikey': settings.sbAnonKey,
      'Authorization': `Bearer ${settings.sbAnonKey}`
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    let errMsg = `HTTP ${response.status} ${response.statusText}`;
    try {
      const errJson = JSON.parse(errText);
      if (errJson && errJson.message) {
        errMsg = errJson.message;
      }
    } catch(e) {}

    // Inspect columns for diagnostic help
    try {
      const cols = await inspectTableSchema(settings, 'pin_keywords');
      if (cols && cols.length > 0) {
        errMsg += ` (Available columns: ${cols.join(', ')})`;
      }
    } catch(e) {}

    throw new Error(`Supabase fetch keywords failed: ${errMsg}`);
  }

  return await response.json();
}

// Fetch Active Image Slots from pin_images
async function fetchActiveImageSlots(settings, keywordId) {
  const sbUrl = settings.sbUrl.replace(/\/$/, '');
  const endpoint = `${sbUrl}/rest/v1/pin_images?keyword_id=eq.${keywordId}&select=slot_index,wp_image_url,title,description,is_done`;
  
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'apikey': settings.sbAnonKey,
      'Authorization': `Bearer ${settings.sbAnonKey}`
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    let errMsg = `HTTP ${response.status} ${response.statusText}`;
    try {
      const errJson = JSON.parse(errText);
      if (errJson && errJson.message) {
        errMsg = errJson.message;
      }
    } catch(e) {}

    // Inspect columns for diagnostic help
    try {
      const cols = await inspectTableSchema(settings, 'pin_images');
      if (cols && cols.length > 0) {
        errMsg += ` (Available columns: ${cols.join(', ')})`;
      }
    } catch(e) {}

    throw new Error(`Supabase fetch slots failed: ${errMsg}`);
  }

  return await response.json();
}

// Scans and audits all keywords & slots in a Pinterest list for quality issues (missing, >500 chars, duplicate titles)
async function auditPinterestList(settings, listId) {
  const rawKeywords = await fetchGrokKeywords(settings, listId);
  
  // Pass 1: Build Title frequency map across all existing slots in the list
  const titleCountMap = new Map();
  for (const kw of rawKeywords) {
    for (const s of (kw.pin_images || [])) {
      if (s.title && s.title.trim()) {
        const norm = s.title.trim().toLowerCase();
        titleCountMap.set(norm, (titleCountMap.get(norm) || 0) + 1);
      }
    }
  }

  let missingCopyCount = 0;
  let tooLongCount = 0;
  let duplicateTitleCount = 0;

  // Pass 2: Filter keywords & slots that need copywriting / re-creation
  const filteredQueue = rawKeywords.map(kw => {
    const allTitlesForKw = (kw.pin_images || [])
      .map(s => s.title && s.title.trim())
      .filter(Boolean);

    const pendingSlots = (kw.pin_images || []).filter(s => {
      if (!s.wp_image_url || s.wp_image_url.trim() === '') {
        return false; // Skip slots without images
      }
      const isMissing = !s.title || s.title.trim() === '' || !s.description || s.description.trim() === '';
      const isTooLong = s.description && s.description.trim().length > 500;
      const isDuplicateTitle = s.title && s.title.trim() && titleCountMap.get(s.title.trim().toLowerCase()) > 1;

      if (isMissing) missingCopyCount++;
      else if (isTooLong) tooLongCount++;
      else if (isDuplicateTitle) duplicateTitleCount++;

      return isMissing || isTooLong || isDuplicateTitle;
    });

    return {
      id: kw.id,
      keyword: kw.keyword,
      annotation_tags: kw.annotation_tags,
      allExistingTitles: allTitlesForKw,
      pendingSlots: pendingSlots
    };
  }).filter(kw => kw.pendingSlots.length > 0);

  return {
    rawKeywords,
    filteredQueue,
    missingCopyCount,
    tooLongCount,
    duplicateTitleCount,
    totalIssues: missingCopyCount + tooLongCount + duplicateTitleCount
  };
}

// Update Pin Image Slot copy
async function updatePinImageSlot(settings, keywordId, slotIndex, title, description) {
  const sbUrl = settings.sbUrl.replace(/\/$/, '');
  const endpoint = `${sbUrl}/rest/v1/pin_images?keyword_id=eq.${keywordId}&slot_index=eq.${slotIndex}`;
  
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      'apikey': settings.sbAnonKey,
      'Authorization': `Bearer ${settings.sbAnonKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      title: title,
      description: description,
      updated_at: new Date().toISOString()
    })
  });

  if (!response.ok) {
    throw new Error(`Supabase patch slot failed: HTTP ${response.status} ${response.statusText}`);
  }
}

// Helper to convert text to clean URL slug
function sanitizeSlug(text) {
  if (!text) return '';
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')    // Remove non-word characters except space and hyphen
    .replace(/[\s_]+/g, '-')     // Replace spaces and underscores with hyphens
    .replace(/-+/g, '-');        // Replace multiple consecutive hyphens with a single one
}

// Smartly enforces Pinterest 500-character limit by trimming at sentence/word boundary
function enforceDescriptionLimit(desc, maxLen = 490) {
  if (!desc) return '';
  let text = desc.trim();
  if (text.length <= 500) {
    return text;
  }
  
  // Cut to maxLen window
  let sub = text.substring(0, maxLen);
  
  // Try to find the last sentence boundary (. ! ?)
  const lastPeriod = Math.max(sub.lastIndexOf('.'), sub.lastIndexOf('!'), sub.lastIndexOf('?'));
  if (lastPeriod > 250) {
    return sub.substring(0, lastPeriod + 1).trim();
  }
  
  // Fall back to last space
  const lastSpace = sub.lastIndexOf(' ');
  if (lastSpace > 250) {
    return sub.substring(0, lastSpace).trim() + '.';
  }
  
  return sub.trim();
}

// Find an existing WordPress post by its exact slug before creating a new one.
async function findExistingWordPressPost(settings, slug) {
  if (!slug) {
    return { success: false, message: 'Cannot perform duplicate protection without a valid post slug.' };
  }

  const wpUrl = normalizeWpUrl(settings.wpUrl);
  const authHeader = 'Basic ' + btoa(settings.wpUsername + ':' + settings.wpAppPassword);
  const params = new URLSearchParams({
    slug,
    status: 'publish,future,draft,pending,private',
    context: 'edit',
    per_page: '1',
    _fields: 'id,slug,status,link'
  });

  try {
    const response = await fetch(`${wpUrl}/wp-json/wp/v2/posts?${params.toString()}`, {
      method: 'GET',
      headers: {
        'Authorization': authHeader,
        'Accept': 'application/json'
      }
    });

    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) {
      const errorText = await response.text();
      const cleanText = errorText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300);
      return {
        success: false,
        message: `WordPress duplicate check returned non-JSON response (HTTP ${response.status}). Raw snippet: "${cleanText}"`
      };
    }

    const data = await response.json();
    if (!response.ok) {
      const errorMsg = data && data.message ? data.message : `HTTP status ${response.status}`;
      return { success: false, message: errorMsg };
    }

    const posts = Array.isArray(data) ? data : [];
    const exactMatch = posts.find(post => post && post.slug === slug) || null;
    return { success: true, post: exactMatch };
  } catch (err) {
    return { success: false, message: err.message || err.toString() };
  }
}

// WordPress publisher with duplicate-slug protection. If the slug already exists,
// skip the WordPress write; the caller will still mark the Supabase item completed.
async function publishToWordPress(settings, title, content, slug, scheduleDate = null) {
  const wpUrl = normalizeWpUrl(settings.wpUrl);
  const postsEndpoint = `${wpUrl}/wp-json/wp/v2/posts`;
  
  // Basic Auth Base64
  const authHeader = 'Basic ' + btoa(settings.wpUsername + ':' + settings.wpAppPassword);
  
  const payload = {
    title: title,
    content: content,
    slug: slug,
    status: scheduleDate ? 'future' : (settings.wpStatus || 'draft')
  };
  
  if (scheduleDate) {
    payload.date = scheduleDate;
  }

  if (settings.wpCategoryId) {
    const catIds = String(settings.wpCategoryId)
      .split(',')
      .map(id => parseInt(id.trim(), 10))
      .filter(id => !isNaN(id) && id > 0);
    if (catIds.length > 0) {
      payload.categories = catIds;
    }
  }

  try {
    const duplicateCheck = await findExistingWordPressPost(settings, slug);
    if (!duplicateCheck.success) {
      return { success: false, message: `Duplicate check failed: ${duplicateCheck.message}` };
    }

    const existingPost = duplicateCheck.post;
    if (existingPost) {
      return {
        success: true,
        duplicate: true,
        skipped: true,
        postId: existingPost.id,
        postStatus: existingPost.status,
        postLink: existingPost.link || ''
      };
    }

    const endpoint = postsEndpoint;
    const operation = 'create';

    // Attempt 1: Standard JSON payload
    console.log(`[AutoAgent] Attempting WordPress ${operation} with JSON payload at ${endpoint}...`);
    let response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // Fallback: If HTTP 415 (Unsupported Media Type), 406 (Not Acceptable) or 400 is returned, retry as Form URL Encoded
    if (!response.ok && (response.status === 415 || response.status === 406 || response.status === 400)) {
      console.warn(`[AutoAgent] WordPress JSON ${operation} returned status ${response.status}. Retrying with urlencoded form-data...`);
      
      const formParams = new URLSearchParams();
      formParams.append('title', payload.title);
      formParams.append('content', payload.content);
      formParams.append('slug', payload.slug);
      formParams.append('status', payload.status);
      if (scheduleDate) {
        formParams.append('date', scheduleDate);
      }
      if (payload.categories && payload.categories.length > 0) {
        payload.categories.forEach(catId => {
          formParams.append('categories[]', catId);
        });
      }

      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formParams.toString()
      });
    }

    // Verify Content-Type is JSON to handle HTML errors gracefully
    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) {
      const errorText = await response.text();
      const cleanText = errorText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300);
      return { 
        success: false, 
        message: `WordPress returned non-JSON response (HTTP ${response.status} ${response.statusText || ''}). Raw snippet: "${cleanText}"` 
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      let parsedError;
      try {
        parsedError = JSON.parse(errorText);
      } catch (e) {}
      
      const errorCode = parsedError && parsedError.code ? ` [${parsedError.code}]` : '';
      const errorMsg = parsedError && parsedError.message ? parsedError.message : (errorText.trim() || response.statusText || 'Unknown error');
      return { success: false, message: `HTTP ${response.status}${errorCode}: ${errorMsg}` };
    }

    const data = await response.json();
    if (!data || !data.id) {
      return { success: false, message: `WordPress ${operation} returned success without a post ID.` };
    }

    return {
      success: true,
      duplicate: false,
      skipped: false,
      postId: data.id,
      postStatus: data.status || payload.status,
      postLink: data.link || ''
    };
  } catch (err) {
    return { success: false, message: err.message || err.toString() };
  }
}

// Validate book article against Bookspect endpoint
async function validateBookArticle(payload, settings) {
  const baseUrl = normalizeWpUrl(settings && settings.wpUrl ? settings.wpUrl : 'https://bookspect.com');
  const endpoint = `${baseUrl}/wp-json/ronin-book-publisher/v1/validate`;
  console.log('[AutoAgent] Sending article to Bookspect validation endpoint...', endpoint);

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  if (settings && settings.wpUsername && settings.wpAppPassword) {
    headers['Authorization'] = 'Basic ' + btoa(settings.wpUsername + ':' + settings.wpAppPassword);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload)
  });

  const contentType = response.headers.get('Content-Type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const errorText = await response.text();
    const cleanText = errorText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300);
    throw new Error(`Bookspect validation returned non-JSON response (HTTP ${response.status}). Snippet: "${cleanText}"`);
  }

  if (!response.ok) {
    const errorMsg = data && (data.message || data.error) ? (data.message || data.error) : `HTTP status ${response.status}`;
    throw new Error(`Bookspect validation rejected: ${errorMsg}`);
  }

  if (data && (data.valid === false || data.success === false)) {
    const errorMsg = data.message || data.error || 'Article validation failed on Bookspect.';
    throw new Error(`Bookspect validation failed: ${errorMsg}`);
  }

  return { success: true, data };
}

// Publish book article to Bookspect endpoint
async function publishBookArticle(payload, settings) {
  const baseUrl = normalizeWpUrl(settings && settings.wpUrl ? settings.wpUrl : 'https://bookspect.com');
  const endpoint = `${baseUrl}/wp-json/ronin-book-publisher/v1/articles`;
  console.log('[AutoAgent] Sending article to Bookspect articles endpoint...', endpoint);

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  if (settings && settings.wpUsername && settings.wpAppPassword) {
    headers['Authorization'] = 'Basic ' + btoa(settings.wpUsername + ':' + settings.wpAppPassword);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload)
  });

  const contentType = response.headers.get('Content-Type') || '';
  let data = null;
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const errorText = await response.text();
    const cleanText = errorText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300);
    throw new Error(`Bookspect publishing returned non-JSON response (HTTP ${response.status}). Snippet: "${cleanText}"`);
  }

  if (!response.ok) {
    const errorMsg = data && (data.message || data.error) ? (data.message || data.error) : `HTTP status ${response.status}`;
    throw new Error(`Bookspect publishing failed: ${errorMsg}`);
  }

  const articleId = data.id || data.article_id || data.post_id || 'OK';
  const articleStatus = data.status || 'published';

  return {
    success: true,
    articleId,
    articleStatus,
    data
  };
}

// --- STATE MACHINE & CONCURRENT WORKER POOL ---

let isProcessing = false;
const activeRunTitles = new Set();

function registerAutomationFailure(error) {
  state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
  return {
    count: state.consecutiveFailures,
    shouldStop: Boolean(error && error.stopAutomation) || state.consecutiveFailures >= 2
  };
}

// --- WORKER PIPELINE: PINTEREST PIN COPYWRITER ---
async function processPinterestKeyword(currentItem, itemIndex, totalCount, workerId, settings) {
  const tag = `[Tab ${workerId} | "${currentItem.keyword}"]`;
  const phaseStr = state.isRetryPhase ? '[Retry Phase] ' : '';
  
  addLog('info', `${tag} ${phaseStr}Processing keyword ${itemIndex + 1}/${totalCount}...`);
  broadcastState();

  // 1. Fetch active slots
  let activeSlots = [];
  if (settings.testMode) {
    addLog('info', `${tag} [Test Mode] Mocking active image slots for testing...`);
    activeSlots = [
      { slot_index: 0, wp_image_url: 'https://mocksite.com/uploads/pin1.jpg' },
      { slot_index: 1, wp_image_url: 'https://mocksite.com/uploads/pin2.jpg' }
    ];
  } else {
    activeSlots = currentItem.pendingSlots || [];
  }

  if (activeSlots.length === 0) {
    addLog('warning', `${tag} No slots requiring copywriting. Skipping.`);
    state.stats.processed++;
    state.stats.remaining = state.queue.length - state.stats.processed;
    saveState();
    broadcastState();
    return;
  }

  addLog('info', `${tag} Found ${activeSlots.length} slot(s) requiring copywriting.`);
  broadcastState();

  // 2. Open dedicated Grok tab for this worker
  const tab = await createTab('https://grok.com/');
  
  try {
    addLog('info', `${tag} Waiting for Grok page to respond...`);
    broadcastState();
    const scriptReady = await waitForContentScriptReady(tab.id);
    if (!scriptReady) {
      throw new Error('Grok page content script response timeout.');
    }

    // 3. Process each slot sequentially within this worker's tab
    for (let sIndex = 0; sIndex < activeSlots.length; sIndex++) {
      if (state.status !== 'RUNNING') break;

      const slot = activeSlots[sIndex];
      addLog('info', `${tag} Slot ${slot.slot_index + 1}/${activeSlots.length} (Index: ${slot.slot_index})...`);
      broadcastState();

      // Construct prompt with excluded titles
      const annotations = Array.isArray(currentItem.annotation_tags) ? currentItem.annotation_tags.join(', ') : '';
      let promptText = settings.pinterestPromptTemplate
        .replace(/{keyword}/gi, currentItem.keyword)
        .replace(/{annotations}/gi, annotations);

      // Collect titles already used for this keyword or flagged as duplicates
      const excludedTitles = [];
      if (slot.title && slot.title.trim()) {
        excludedTitles.push(slot.title.trim());
      }
      if (Array.isArray(currentItem.allExistingTitles)) {
        for (const t of currentItem.allExistingTitles) {
          if (t && t.trim() && !excludedTitles.includes(t.trim())) {
            excludedTitles.push(t.trim());
          }
        }
      }

      if (excludedTitles.length > 0) {
        const titlesList = excludedTitles.slice(0, 6).map(t => `- "${t}"`).join('\n');
        promptText += `\n\nCRITICAL TITLE RULE:\nDo NOT use, copy, or repeat any of the following already-used titles (you must write a completely new, unique title):\n${titlesList}`;
      }

      addLog('info', `${tag} Submitting prompt for Slot ${slot.slot_index + 1}...`);
      broadcastState();

      if (state.status !== 'RUNNING') break;

      const promptResult = await sendMessageToTab(tab.id, { action: 'enterPrompt', prompt: promptText });
      if (promptResult.status !== 'success') {
        throw new Error(`Failed to type/submit prompt: ${promptResult.message || 'unknown error'}`);
      }

      addLog('info', `${tag} Waiting for Slot ${slot.slot_index + 1} copywriting generation...`);
      broadcastState();

      if (state.status !== 'RUNNING') break;

      try {
        await pollGenerationComplete(tab.id, 600000);
      } catch (pollErr) {
        throw new Error(`Generation error: ${pollErr.message}`);
      }

      addLog('info', `${tag} Generation complete. Scraping response content...`);
      broadcastState();

      if (state.status !== 'RUNNING') break;

      const extractResult = await sendClipboardMessageToTab(tab.id, { action: 'extractContent' });
      if (extractResult.status !== 'success') {
        const extractionError = new Error(`Extraction failed: ${extractResult.message}`);
        extractionError.stopAutomation = Boolean(extractResult.fatal);
        throw extractionError;
      }

      const rawText = extractResult.markdown;
      
      // Extract JSON
      let parsed = null;
      try {
        const startIdx = rawText.indexOf('{');
        const endIdx = rawText.lastIndexOf('}');
        if (startIdx !== -1 && endIdx !== -1) {
          const jsonStr = rawText.slice(startIdx, endIdx + 1);
          parsed = JSON.parse(jsonStr);
        }
      } catch (e) {
        console.error('Failed to parse JSON:', e);
      }

      if (!parsed || !parsed.title || !parsed.description) {
        addLog('error', `${tag} Grok response did not contain a valid JSON title and description for Slot ${slot.slot_index + 1}. Raw: ${rawText.substring(0, 150)}...`);
        throw new Error('Failed to parse JSON containing title and description from Grok response.');
      }

      let pinTitle = parsed.title.trim();
      const rawPinDesc = parsed.description.trim();

      // Enforce Description <= 500 characters
      const pinDesc = enforceDescriptionLimit(rawPinDesc, 490);
      if (rawPinDesc.length > 500) {
        addLog('info', `${tag} Description was ${rawPinDesc.length} chars (exceeded 500 limit). Trimmed cleanly to ${pinDesc.length} chars.`);
      }

      // Title deduplication check against current batch
      const normTitle = pinTitle.toLowerCase();
      if (activeRunTitles.has(normTitle)) {
        addLog('warning', `${tag} Title "${pinTitle}" was already used in this batch. Generating unique variation...`);
        pinTitle = `${pinTitle} | Top Ideas`.substring(0, 70).trim();
      }
      activeRunTitles.add(pinTitle.toLowerCase());

      addLog('success', `${tag} Slot ${slot.slot_index + 1} Pin Copy (${pinDesc.length} chars):\nTitle: "${pinTitle}"\nDescription: "${pinDesc}"`);
      broadcastState();

      if (settings.testMode) {
        addLog('info', `${tag} [Test Mode] Bypassing database update. Downloading result as JSON...`);
        const testData = {
          keyword: currentItem.keyword,
          slot_index: slot.slot_index,
          wp_image_url: slot.wp_image_url,
          title: pinTitle,
          description: pinDesc
        };
        chrome.downloads.download({
          url: 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(testData, null, 2)),
          filename: `test-pin-copy-slot-${slot.slot_index + 1}-${currentItem.keyword.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`,
          saveAs: false
        });
      } else {
        addLog('info', `${tag} Updating slot row in Supabase...`);
        await updatePinImageSlot(settings, currentItem.id, slot.slot_index, pinTitle, pinDesc);
        addLog('success', `${tag} Supabase slot row updated successfully.`);
      }

      // Slot cooldown
      if (sIndex < activeSlots.length - 1 && settings.actionDelay > 0) {
        addLog('info', `${tag} Waiting for slot cooldown delay of ${settings.actionDelay}s...`);
        await delay(settings.actionDelay * 1000);
      }
    }

    if (state.status === 'RUNNING') {
      state.stats.processed++;
      state.stats.remaining = state.queue.length - state.stats.processed;
      saveState();
      broadcastState();
    }
  } finally {
    cleanupTab(tab.id);
  }
}

// --- WORKER PIPELINE: WORDPRESS ARTICLE PUBLISHER ---
async function processArticleKeyword(currentItem, itemIndex, totalCount, scheduleDate, workerId, settings) {
  const tag = `[Tab ${workerId} | "${currentItem.keyword}"]`;
  const phaseStr = state.isRetryPhase ? '[Retry Phase] ' : '';

  addLog('info', `${tag} ${phaseStr}Processing keyword ${itemIndex + 1}/${totalCount}...`);
  broadcastState();

  // Check the deterministic keyword slug before spending time generating content.
  // Recheck again during publish to protect against races between parallel workers.
  if (!settings.testMode) {
    const initialSlug = sanitizeSlug(currentItem.keyword);
    if (initialSlug) {
      addLog('info', `${tag} Pre-checking WordPress slug "${initialSlug}" before generation...`);
      broadcastState();
      const existingCheck = await findExistingWordPressPost(settings, initialSlug);
      if (!existingCheck.success) {
        throw new Error(`WordPress duplicate pre-check failed: ${existingCheck.message}`);
      }
      if (existingCheck.post) {
        addLog('success', `${tag} Existing WordPress slug found. Generation and upload skipped. Marking keyword completed. ID: ${existingCheck.post.id}, status: ${existingCheck.post.status}.`);
        broadcastState();
        await updateKeywordStatus(settings, currentItem.id, 'completed');
        state.stats.processed++;
        state.stats.remaining = Math.max(0, state.queue.length - state.stats.processed);
        saveState();
        broadcastState();
        return;
      }
    }
  }

  // 1. Open Grok tab
  const tab = await createTab('https://grok.com/');

  let finalTitle = currentItem.keyword;
  let finalMarkdown = '';
  let finalHtml = '';
  let parsedMd = { title: '', intro: '', body: '' };
  let parsedHtml = { title: '', intro: '', body: '' };
  let newIntroHtml = '';
  let newIntroMarkdown = '';

  try {
    addLog('info', `${tag} Waiting for Grok page to respond...`);
    broadcastState();
    const scriptReady = await waitForContentScriptReady(tab.id);
    if (!scriptReady) {
      throw new Error('Grok page content script response timeout.');
    }

    // Submit prompt
    const formattedPrompt = settings.promptTemplate.replace(/{keyword}/gi, currentItem.keyword)
      + '\n\nIMPORTANT: Do not attach the article as a file, document, or download block. You must write the entire article directly in the chat message response.';
    addLog('info', `${tag} Submitting prompt to Grok...`);
    broadcastState();

    if (state.status !== 'RUNNING') return;

    const promptResult = await sendMessageToTab(tab.id, { action: 'enterPrompt', prompt: formattedPrompt });
    if (promptResult.status !== 'success') {
      throw new Error(`Failed to type/submit prompt: ${promptResult.message || 'unknown error'}`);
    }

    addLog('info', `${tag} Article generation streaming... waiting for completion.`);
    broadcastState();

    if (state.status !== 'RUNNING') return;

    try {
      await pollGenerationComplete(tab.id, 600000);
    } catch (pollErr) {
      throw new Error(`Generation error: ${pollErr.message}`);
    }

    addLog('info', `${tag} Generation complete. Scraping article content...`);
    broadcastState();

    if (state.status !== 'RUNNING') return;

    const extractResult = await sendClipboardMessageToTab(tab.id, { action: 'extractContent' });
    if (extractResult.status !== 'success') {
      const extractionError = new Error(`Extraction failed: ${extractResult.message}`);
      extractionError.stopAutomation = Boolean(extractResult.fatal);
      throw extractionError;
    }
 
    const articleHtml = extractResult.content;
    const articleMarkdown = extractResult.markdown;
    addLog('success', `${tag} Grok Copy button succeeded; clipboard content received by the publisher.`);
    broadcastState();
    
    const grokWordCount = articleMarkdown.split(/\s+/).filter(Boolean).length;
    if (grokWordCount < (settings.testMode ? 30 : 250)) {
      throw new Error(`Grok generated article was too short or incomplete (${grokWordCount} words). Expected at least 250 words.`);
    }

    const copiedH2Count = (articleMarkdown.match(/^##\s+/gm) || []).length;
    if (/^\s*Worked for \d+s/i.test(articleMarkdown)) {
      throw new Error('Copy validation failed: Grok interface text was detected at the start of the copied article. Refusing to publish DOM-derived content.');
    }
    if (copiedH2Count === 0) {
      throw new Error('Copy validation failed: the clipboard article contains no Markdown H2 headings. Refusing to publish flattened/plain-text content.');
    }

    const grokPreview = articleMarkdown.split('\n').filter(l => l.trim()).slice(0, 5).join('\n');
    addLog('success', `${tag} Scraped Grok Article (${grokWordCount} words):\n${grokPreview}`);
    broadcastState();

    parsedMd = parseGrokOutput(articleMarkdown);
    parsedHtml = parseHtmlGrokOutput(articleHtml);

    if (parsedMd.title || parsedHtml.title) {
      finalTitle = parsedMd.title || parsedHtml.title;
      addLog('info', `${tag} Extracted title from Grok: "${finalTitle}"`);
    }

    finalMarkdown = `${parsedMd.intro}\n\n${parsedMd.body}`.trim();
    finalHtml = markdownToHtml(finalMarkdown);

  } finally {
    cleanupTab(tab.id);
  }

  if (state.status !== 'RUNNING') return;

  // 2. Custom GPT Intro Rewrite (if configured)
  if (settings.gptRewrite && settings.customGptUrl) {
    addLog('info', `${tag} Navigating to Custom GPT: ${settings.customGptUrl}`);
    broadcastState();

    const gptTab = await createTab(settings.customGptUrl);

    try {
      addLog('info', `${tag} Waiting for Custom GPT page to respond...`);
      broadcastState();
      const gptReady = await waitForContentScriptReady(gptTab.id);
      if (!gptReady) {
        throw new Error('Custom GPT content script response timeout.');
      }

      await new Promise(r => setTimeout(r, 4000));

      addLog('info', `${tag} Submitting keyword to Custom GPT...`);
      broadcastState();
      const promptResult = await sendMessageToTab(gptTab.id, { action: 'enterPrompt', prompt: currentItem.keyword });
      if (promptResult.status !== 'success') {
        throw new Error(`Failed to submit keyword to Custom GPT: ${promptResult.message}`);
      }

      addLog('info', `${tag} Custom GPT intro generation streaming...`);
      broadcastState();
      try {
        await pollGptIntroComplete(gptTab.id, 600000);
      } catch (pollErr) {
        throw new Error(`Custom GPT generation failed: ${pollErr.message}`);
      }

      const extractResult = await sendClipboardMessageToTab(gptTab.id, { action: 'waitForGptIntro' });
      if (extractResult.status !== 'success') {
        const extractionError = new Error(`Custom GPT extraction failed: ${extractResult.message}`);
        extractionError.stopAutomation = Boolean(extractResult.fatal);
        throw extractionError;
      }

      newIntroHtml = extractResult.content;
      newIntroMarkdown = extractResult.markdown;

      const wordCount = newIntroMarkdown.split(/\s+/).filter(Boolean).length;
      addLog('success', `${tag} Extracted intro (${wordCount} words): "${newIntroMarkdown.substring(0, 80).replace(/\n/g, ' ')}..."`);
      broadcastState();

      if (wordCount < 15) {
        throw new Error(`Custom GPT introduction was too short or empty (${wordCount} words).`);
      }

      finalMarkdown = `${newIntroMarkdown}\n\n${parsedMd.body}`.trim();
      finalHtml = markdownToHtml(finalMarkdown);

    } finally {
      cleanupTab(gptTab.id);
    }
  }

  if (state.status !== 'RUNNING') return;

  // 3. Listicle GPT Section (if configured)
  if (settings.listicle && settings.listicleGptUrl) {
    addLog('info', `${tag} Listicle Mode enabled. Navigating to Listicle GPT: ${settings.listicleGptUrl}`);
    broadcastState();

    const listicleTab = await createTab(settings.listicleGptUrl);

    try {
      addLog('info', `${tag} Waiting for Listicle GPT page to respond...`);
      broadcastState();
      const listicleReady = await waitForContentScriptReady(listicleTab.id);
      if (!listicleReady) {
        throw new Error('Listicle GPT content script response timeout.');
      }

      await new Promise(r => setTimeout(r, 4000));

      addLog('info', `${tag} Submitting keyword to Listicle GPT: "${currentItem.keyword}"...`);
      broadcastState();

      const listiclePromptResult = await sendMessageToTab(listicleTab.id, { action: 'enterPrompt', prompt: currentItem.keyword });
      if (listiclePromptResult.status !== 'success') {
        throw new Error(`Failed to submit keyword to Listicle GPT: ${listiclePromptResult.message}`);
      }

      addLog('info', `${tag} Listicle GPT generation streaming...`);
      broadcastState();
      try {
        await pollGptIntroComplete(listicleTab.id, 600000);
      } catch (pollErr) {
        throw new Error(`Listicle GPT generation failed: ${pollErr.message}`);
      }

      const extractResult = await sendClipboardMessageToTab(listicleTab.id, { action: 'waitForGptIntro' });
      if (extractResult.status !== 'success') {
        const extractionError = new Error(`Listicle GPT extraction failed: ${extractResult.message}`);
        extractionError.stopAutomation = Boolean(extractResult.fatal);
        throw extractionError;
      }

      const listicleSectionHtml = extractResult.content;
      const listicleSectionMarkdown = extractResult.markdown;
      const listicleWordCount = listicleSectionMarkdown.split(/\s+/).filter(Boolean).length;
      if (listicleWordCount < 15) {
        throw new Error(`Listicle GPT section was too short or empty (${listicleWordCount} words).`);
      }

      addLog('success', `${tag} Listicle section extracted (${listicleWordCount} words). Splicing...`);
      broadcastState();

      if (settings.gptRewrite && settings.customGptUrl) {
        finalMarkdown = `${newIntroMarkdown}\n\n${listicleSectionMarkdown}\n\n${parsedMd.body}`.trim();
      } else {
        finalMarkdown = `${parsedMd.intro}\n\n${listicleSectionMarkdown}\n\n${parsedMd.body}`.trim();
      }
      finalHtml = markdownToHtml(finalMarkdown);

    } finally {
      cleanupTab(listicleTab.id);
    }
  }

  if (state.status !== 'RUNNING') return;

  // 4. Publish / Download Output
  if (settings.testMode) {
    addLog('info', `${tag} [Test Mode] Bypassing WordPress/Supabase. Downloading Markdown file...`);
    broadcastState();

    const safeKw = finalTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const dateSuffix = scheduleDate ? `-${scheduleDate.replace(/[:]/g, '_')}` : '';
    chrome.downloads.download({
      url: 'data:text/markdown;charset=utf-8,' + encodeURIComponent(finalMarkdown),
      filename: `test-article-${safeKw}${dateSuffix}.md`,
      saveAs: false
    }, (downloadId) => {
      if (chrome.downloads.lastError) {
        addLog('error', `${tag} [Test Mode] Download failed: ${chrome.downloads.lastError.message}`);
      } else {
        const schedMsg = scheduleDate ? ` (simulated schedule: ${scheduleDate})` : '';
        addLog('success', `${tag} [Test Mode] Markdown document downloaded${schedMsg}. ID: ${downloadId}`);
      }
      broadcastState();
    });

    state.stats.processed++;
    state.stats.remaining = state.queue.length - state.stats.processed;
    saveState();
    broadcastState();
  } else {
    if (scheduleDate) {
      addLog('info', `${tag} Publishing to WordPress (scheduled: ${scheduleDate})...`);
    } else {
      addLog('info', `${tag} Publishing to WordPress as "${settings.wpStatus}"...`);
    }
    broadcastState();

    const slug = sanitizeSlug(currentItem.keyword) || sanitizeSlug(finalTitle);
    const compiledH2Count = (finalHtml.match(/<h2\b/g) || []).length;
    const compiledH3Count = (finalHtml.match(/<h3\b/g) || []).length;
    const compiledTableCount = (finalHtml.match(/<table\b/g) || []).length;
    addLog('info', `${tag} WordPress formatting compiled: ${compiledH2Count} H2, ${compiledH3Count} H3, ${compiledTableCount} table(s).`);
    addLog('info', `${tag} Checking WordPress for existing slug: "${slug}"...`);
    broadcastState();

    const wpResult = await publishToWordPress(settings, finalTitle, finalHtml, slug, scheduleDate);
    if (!wpResult.success) {
      throw new Error(`WordPress publishing failed: ${wpResult.message}`);
    }
    if (wpResult.duplicate) {
      addLog('success', `${tag} Existing WordPress slug found. WordPress upload skipped and the keyword will be marked completed. ID: ${wpResult.postId}, status: ${wpResult.postStatus}.`);
    } else {
      addLog('success', `${tag} New post uploaded to WordPress. ID: ${wpResult.postId}, status: ${wpResult.postStatus}.`);
    }
    broadcastState();

    addLog('info', `${tag} Updating Supabase status to completed...`);
    broadcastState();
    await updateKeywordStatus(settings, currentItem.id, 'completed');
    addLog('success', `${tag} Supabase updated successfully.`);
    broadcastState();

    state.stats.processed++;
    state.stats.remaining = state.queue.length - state.stats.processed;
    saveState();
    broadcastState();
  }
}

// --- WORKER PIPELINE: BOOK PUBLISHER (BOOKSPECT) ---
async function processBookKeyword(currentItem, itemIndex, totalCount, scheduleDate, workerId, settings) {
  const tag = `[Tab ${workerId} | "${currentItem.keyword}"]`;
  const phaseStr = state.isRetryPhase ? '[Retry Phase] ' : '';

  addLog('info', `${tag} ${phaseStr}Processing book keyword ${itemIndex + 1}/${totalCount}...`);
  broadcastState();

  // 1. Open Grok tab
  const tab = await createTab('https://grok.com/');

  let finalTitle = currentItem.keyword;
  let flattenedText = '';

  try {
    addLog('info', `${tag} Waiting for Grok page to respond...`);
    broadcastState();
    const scriptReady = await waitForContentScriptReady(tab.id);
    if (!scriptReady) {
      throw new Error('Grok page content script response timeout.');
    }

    // Submit prompt
    const promptTpl = settings.bookPromptTemplate || settings.promptTemplate;
    const formattedPrompt = promptTpl.replace(/{keyword}/gi, currentItem.keyword);

    addLog('info', `${tag} Submitting book prompt to Grok...`);
    broadcastState();

    if (state.status !== 'RUNNING') return;

    const promptResult = await sendMessageToTab(tab.id, { action: 'enterPrompt', prompt: formattedPrompt });
    if (promptResult.status !== 'success') {
      throw new Error(`Failed to type/submit prompt: ${promptResult.message || 'unknown error'}`);
    }

    addLog('info', `${tag} Book chapter streaming... waiting for completion.`);
    broadcastState();

    if (state.status !== 'RUNNING') return;

    try {
      await pollGenerationComplete(tab.id, 600000);
    } catch (pollErr) {
      throw new Error(`Generation error: ${pollErr.message}`);
    }

    addLog('info', `${tag} Generation complete. Scraping book content...`);
    broadcastState();

    if (state.status !== 'RUNNING') return;

    try {
      await chrome.tabs.update(tab.id, { active: true });
    } catch (e) {}

    const extractResult = await sendClipboardMessageToTab(tab.id, { action: 'extractContent' });
    if (extractResult.status !== 'success') {
      const extractionError = new Error(`Extraction failed: ${extractResult.message}`);
      extractionError.stopAutomation = Boolean(extractResult.fatal);
      throw extractionError;
    }

    const rawMarkdown = extractResult.markdown;
    const rawWordCount = rawMarkdown.split(/\s+/).filter(Boolean).length;
    if (rawWordCount < (settings.testMode ? 30 : 250)) {
      throw new Error(`Grok generated book chapter was too short or incomplete (${rawWordCount} words). Expected at least 250 words.`);
    }

    // Extract title from output if present
    const lines = rawMarkdown.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      const firstLine = lines[0].replace(/^#+\s*/, '').replace(/\*+/g, '').trim();
      if (firstLine && firstLine.length <= 120) {
        finalTitle = firstLine;
      }
    }

    // Compile into flattened plain text (no markdown syntax)
    flattenedText = flattenMarkdownToPlainText(rawMarkdown);
    const bookWordCount = flattenedText.split(/\s+/).filter(Boolean).length;

    const preview = flattenedText.split('\n').filter(l => l.trim()).slice(0, 5).join('\n');
    addLog('success', `${tag} Scraped Book Chapter (${bookWordCount} words, flattened plain text):\n${preview}`);
    broadcastState();

  } finally {
    cleanupTab(tab.id);
  }

  if (state.status !== 'RUNNING') return;

  // 2. Publish / Download Output
  if (settings.testMode) {
    addLog('info', `${tag} [Test Mode] Bypassing Bookspect endpoints. Downloading flattened text file...`);
    broadcastState();

    const safeKw = finalTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    chrome.downloads.download({
      url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(flattenedText),
      filename: `test-book-${safeKw}.txt`,
      saveAs: false
    }, (downloadId) => {
      if (chrome.downloads.lastError) {
        addLog('error', `${tag} [Test Mode] Download failed: ${chrome.downloads.lastError.message}`);
      } else {
        addLog('success', `${tag} [Test Mode] Flattened book document downloaded. ID: ${downloadId}`);
      }
      broadcastState();
    });

    state.stats.processed++;
    state.stats.remaining = state.queue.length - state.stats.processed;
    saveState();
    broadcastState();
  } else {
    const slug = sanitizeSlug(currentItem.keyword) || sanitizeSlug(finalTitle);
    const payload = {
      title: finalTitle,
      content: flattenedText,
      keyword: currentItem.keyword,
      slug: slug,
      status: scheduleDate ? 'future' : (settings.wpStatus || 'publish')
    };

    if (scheduleDate) {
      payload.date = scheduleDate;
    }

    if (settings.wpCategoryId) {
      const catIds = String(settings.wpCategoryId)
        .split(',')
        .map(id => parseInt(id.trim(), 10))
        .filter(id => !isNaN(id) && id > 0);
      if (catIds.length > 0) {
        payload.categories = catIds;
      }
    }

    // Step 1: Validate
    addLog('info', `${tag} Validating article with Bookspect endpoint...`);
    broadcastState();

    await validateBookArticle(payload, settings);
    addLog('success', `${tag} Validation succeeded by Bookspect.`);
    broadcastState();

    if (state.status !== 'RUNNING') return;

    // Step 2: Publish
    addLog('info', `${tag} Publishing article to Bookspect...`);
    broadcastState();

    const pubResult = await publishBookArticle(payload, settings);
    addLog('success', `${tag} Published to Bookspect successfully! Article ID: ${pubResult.articleId}, Status: ${pubResult.articleStatus}.`);
    broadcastState();

    // Step 3: Supabase update
    addLog('info', `${tag} Updating Supabase status to completed...`);
    broadcastState();
    await updateKeywordStatus(settings, currentItem.id, 'completed');
    addLog('success', `${tag} Supabase updated successfully.`);
    broadcastState();

    state.stats.processed++;
    state.stats.remaining = state.queue.length - state.stats.processed;
    saveState();
    broadcastState();
  }
}

// --- STATE MACHINE DISPATCHER ---
async function runStateMachine(isInternal = false) {
  if (state.status !== 'RUNNING') {
    isProcessing = false;
    return;
  }
  if (!isInternal && isProcessing) {
    console.log('[AutoAgent] runStateMachine already running. Ignoring duplicate call.');
    return;
  }
  isProcessing = true;

  try {
    const settings = await getSettings();

    // Check if queue needs loading
    if (state.queue.length === 0) {
      if (settings.testMode) {
        addLog('warning', '[Test Mode] Enabled: the Supabase Keyword List Name is ignored and only Test Keywords are used.');
        broadcastState();
        
        const rawKws = settings.testKeywords || '';
        const kwList = rawKws.split(/[\n,]/).map(k => k.trim()).filter(Boolean);
        if (kwList.length === 0) {
          addLog('error', '[Test Mode] No Test Keywords were supplied. Stopping instead of generating sample or unrelated keywords. Disable Test Mode to fetch the selected Supabase list.');
          state.status = 'IDLE';
          state.queue = [];
          state.currentIndex = 0;
          state.stats = { processed: 0, remaining: 0, total: 0 };
          saveState();
          broadcastState();
          isProcessing = false;
          return;
        }
        
        state.queue = kwList.map((kw, i) => ({ id: `test-kw-${i}`, keyword: kw }));
        state.scheduleDates = settings.wpStatus === 'schedule' ? generateScheduleDates(state.queue.length, settings) : [];
        state.currentIndex = 0;
        state.stats.total = state.queue.length;
        state.stats.processed = 0;
        state.stats.remaining = state.queue.length;
        state.failedKeywords = [];
        state.consecutiveFailures = 0;
        state.isRetryPhase = false;
        
        addLog('success', `[Test Mode] Test queue ready with ${state.queue.length} keywords.`);
        if (settings.wpStatus === 'schedule') {
          addLog('info', '[Test Mode] Generated schedules:\n' + state.scheduleDates.map((d, i) => `  - "${state.queue[i].keyword}" -> ${d}`).join('\n'));
        }
        saveState();
        broadcastState();
      } else {
        addLog('info', 'Initializing content automation batch...');
        broadcastState();

        addLog('info', `Resolving List Name: "${settings.sbListName}"`);
        broadcastState();
        
        const listId = await fetchListId(settings);
        if (!listId) {
          addLog('error', `List name "${settings.sbListName}" was not found in Supabase.`);
          state.status = 'IDLE';
          saveState();
          broadcastState();
          isProcessing = false;
          return;
        }
        addLog('info', `Resolved List ID: ${listId}`);
        broadcastState();

        if (settings.automationMode === 'pinterest') {
          activeRunTitles.clear();
          addLog('info', `Scanning Pinterest list "${settings.sbListName}" for quality issues (Limit: ${settings.sbBatchLimit})...`);
          broadcastState();
          
          const audit = await auditPinterestList(settings, listId);
          addLog('info', `[Quality Audit] Scan complete: ${audit.missingCopyCount} missing copy, ${audit.tooLongCount} descriptions > 500 chars, ${audit.duplicateTitleCount} duplicate titles flagged.`);
          broadcastState();

          if (audit.filteredQueue.length === 0) {
            addLog('success', 'All Pinterest keywords and slots already have valid, unique copy (≤ 500 chars). No updates needed.');
            state.status = 'IDLE';
            saveState();
            broadcastState();
            isProcessing = false;
            return;
          }
          state.queue = audit.filteredQueue;
          state.resolutionPass = 1;
        } else {
          addLog('info', `Fetching pending and failed keywords (Limit: ${settings.sbBatchLimit})...`);
          broadcastState();
          const keywords = await fetchPendingKeywords(settings, listId);
          if (keywords.length === 0) {
            addLog('warning', 'No pending or failed keywords found to process.');
            state.status = 'IDLE';
            saveState();
            broadcastState();
            isProcessing = false;
            return;
          }
          state.queue = keywords;
        }

        if (settings.automationMode === 'article' || settings.automationMode === 'book') {
          state.scheduleDates = settings.wpStatus === 'schedule' ? generateScheduleDates(state.queue.length, settings) : [];
        } else {
          state.scheduleDates = [];
        }
        state.currentIndex = 0;
        state.stats.total = state.queue.length;
        state.stats.processed = 0;
        state.stats.remaining = state.queue.length;
        state.failedKeywords = [];
        state.consecutiveFailures = 0;
        state.isRetryPhase = false;
        addLog('success', `Queue ready with ${state.queue.length} items.`);
        if ((settings.automationMode === 'article' || settings.automationMode === 'book') && settings.wpStatus === 'schedule') {
          addLog('info', 'Generated schedules:\n' + state.scheduleDates.map((d, i) => `  - "${state.queue[i].keyword}" -> ${d}`).join('\n'));
        }
        saveState();
        broadcastState();
      }
    }

    // Launch multi-tab worker pool
    const total = state.queue.length;
    const concurrency = Math.max(1, Math.min(settings.concurrency || 2, total - state.currentIndex, 3));
    addLog('info', `Running worker pool with concurrency: ${concurrency} parallel tab(s)...`);
    broadcastState();

    let nextQueueIndex = state.currentIndex;
    let failureStopTriggered = false;

    async function runWorker(workerId) {
      while (state.status === 'RUNNING') {
        if (nextQueueIndex >= total) break;
        const itemIndex = nextQueueIndex++;
        state.currentIndex = nextQueueIndex;
        saveState();
        broadcastState();

        const currentItem = state.queue[itemIndex];
        if (!currentItem) break;

        try {
          if (settings.automationMode === 'pinterest') {
            await processPinterestKeyword(currentItem, itemIndex, total, workerId, settings);
          } else if (settings.automationMode === 'book') {
            const scheduleDate = state.scheduleDates && state.scheduleDates[itemIndex] ? state.scheduleDates[itemIndex] : null;
            await processBookKeyword(currentItem, itemIndex, total, scheduleDate, workerId, settings);
          } else {
            const scheduleDate = state.scheduleDates && state.scheduleDates[itemIndex] ? state.scheduleDates[itemIndex] : null;
            await processArticleKeyword(currentItem, itemIndex, total, scheduleDate, workerId, settings);
          }
          if (failureStopTriggered || state.status !== 'RUNNING') break;
          state.consecutiveFailures = 0;
          saveState();
        } catch (err) {
          if (failureStopTriggered || state.status !== 'RUNNING') {
            addLog('warning', `[Tab ${workerId} | "${currentItem.keyword}"] Interrupted because the automation was stopped.`);
            break;
          }

          addLog('error', `[Tab ${workerId} | "${currentItem.keyword}"] Failed: ${err.message}`);
          const failureDecision = registerAutomationFailure(err);
          addLog('warning', `Consecutive automation failures: ${failureDecision.count}/2. This includes generation, Copy, formatting, WordPress upload, and Supabase update failures. Any successful item resets the count.`);
          if (!state.isRetryPhase) {
            state.failedKeywords.push(currentItem);
          }
          state.stats.processed++;
          state.stats.remaining = total - state.stats.processed;
          saveState();
          broadcastState();

          const reachedFailureLimit = failureDecision.shouldStop;
          if (reachedFailureLimit) {
            failureStopTriggered = true;
            state.status = 'IDLE';
            isProcessing = false;
            const stopReason = err.stopAutomation
              ? 'Two consecutive Copy/clipboard attempts failed.'
              : 'Two consecutive items failed.';
            addLog('error', `${stopReason} Automation stopped and all generation tabs were closed. Pending/failed items remain available for the next Start.`);
            cleanupAllActiveTabs();
            saveState();
            broadcastState();
          }

          if ((settings.automationMode === 'article' || settings.automationMode === 'book') && !settings.testMode) {
            try {
              await updateKeywordStatus(settings, currentItem.id, 'failed');
            } catch(e) {}
          }

          if (reachedFailureLimit) break;
        }

        if (state.status === 'RUNNING' && nextQueueIndex < total && settings.actionDelay > 0) {
          addLog('info', `[Tab ${workerId}] Waiting for cooldown delay of ${settings.actionDelay}s...`);
          await delay(settings.actionDelay * 1000);
        }
      }
    }

    const workerPromises = [];
    for (let w = 1; w <= concurrency; w++) {
      workerPromises.push(
        (async () => {
          if (w > 1) await delay((w - 1) * 1500); // 1.5s stagger between tab openings
          return runWorker(w);
        })()
      );
    }

    await Promise.all(workerPromises);

    if (state.status !== 'RUNNING') {
      isProcessing = false;
      return;
    }

    // Check if Pinterest quality re-audit loop needed
    if (settings.automationMode === 'pinterest' && !settings.testMode) {
      addLog('info', 'Pass completed. Re-auditing Pinterest list in Supabase to verify all issues are resolved...');
      broadcastState();

      const listId = await fetchListId(settings);
      const audit = await auditPinterestList(settings, listId);

      if (audit.totalIssues > 0) {
        state.resolutionPass = (state.resolutionPass || 1) + 1;
        if (state.resolutionPass > 5) {
          addLog('warning', `Reached maximum safety limit of 5 resolution passes. Finished with ${audit.totalIssues} unresolved slots.`);
        } else {
          addLog('warning', `[Quality Audit Loop] Found ${audit.totalIssues} remaining slots with issues (${audit.missingCopyCount} missing, ${audit.tooLongCount} > 500 chars, ${audit.duplicateTitleCount} duplicate titles). Auto-launching Resolution Pass ${state.resolutionPass}...`);
          state.queue = audit.filteredQueue;
          state.currentIndex = 0;
          state.stats.total = state.queue.length;
          state.stats.processed = 0;
          state.stats.remaining = state.queue.length;
          state.failedKeywords = [];
          state.isRetryPhase = true;
          saveState();
          broadcastState();

          addLog('info', `Waiting for cooldown delay of ${settings.actionDelay}s before Pass ${state.resolutionPass}...`);
          await delay(settings.actionDelay * 1000);
          isProcessing = false;
          runStateMachine(true);
          return;
        }
      } else {
        addLog('success', 'All Pinterest slots in the list are 100% resolved with unique titles and valid descriptions (≤ 500 chars)!');
      }
    } else if (state.failedKeywords.length > 0 && !state.isRetryPhase) {
      addLog('warning', `Batch finished with ${state.failedKeywords.length} failed items. Launching single retry phase...`);
      state.queue = [...state.failedKeywords];
      state.currentIndex = 0;
      state.stats.total = state.queue.length;
      state.stats.processed = 0;
      state.stats.remaining = state.queue.length;
      state.failedKeywords = [];
      state.isRetryPhase = true;
      saveState();
      broadcastState();

      addLog('info', `Waiting for cooldown delay of ${settings.actionDelay}s before retry...`);
      await delay(settings.actionDelay * 1000);
      isProcessing = false;
      runStateMachine(true);
      return;
    }

    addLog('success', 'All automation tasks completed successfully!');
    state.status = 'COMPLETED';
    state.queue = [];
    state.currentIndex = 0;
    cleanupAllActiveTabs();
    saveState();
    broadcastState();
    isProcessing = false;

  } catch (err) {
    addLog('error', `Automation error: ${err.message}`);
    state.status = 'IDLE';
    isProcessing = false;
    cleanupAllActiveTabs();
    saveState();
    broadcastState();
  }
}

// --- MESSAGE ROUTER ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'requestClipboardFocus') {
    const senderTabId = sender.tab && sender.tab.id;
    if (!senderTabId) {
      sendResponse({ status: 'error', message: 'Clipboard focus request did not come from a browser tab.' });
      return;
    }

    focusTabForClipboard(senderTabId)
      .then(() => sendResponse({ status: 'success' }))
      .catch(err => sendResponse({ status: 'error', message: err.message || err.toString() }));
    return true;
  }

  if (message.action === 'getState') {
    sendResponse(state);
    return;
  }

  if (message.action === 'start') {
    if (state.status === 'RUNNING') {
      sendResponse(state);
      return;
    }
    if (state.status === 'PAUSED') {
      cleanupAllActiveTabs();
      state.status = 'RUNNING';
      state.queue = [];
      state.scheduleDates = [];
      state.currentIndex = 0;
      state.stats = { processed: 0, remaining: 0, total: 0 };
      state.failedKeywords = [];
      state.consecutiveFailures = 0;
      state.isRetryPhase = false;
      addLog('info', 'Resuming automation with a fresh pending/failed queue so the interrupted item is not skipped.');
      saveState();
      runStateMachine();
    } else {
      // New batch
      state.status = 'RUNNING';
      state.queue = [];
      state.currentIndex = 0;
      state.stats = { processed: 0, remaining: 0, total: 0 };
      state.failedKeywords = [];
      state.consecutiveFailures = 0;
      state.isRetryPhase = false;
      addLog('info', 'Starting automation.');
      saveState();
      runStateMachine();
    }
    sendResponse(state);
    return;
  }

  if (message.action === 'pause') {
    if (state.status === 'RUNNING') {
      state.status = 'PAUSED';
      isProcessing = false;
      addLog('warning', 'Automation paused. The queue will be refreshed from pending/failed items on resume.');
      cleanupAllActiveTabs();
      state.queue = [];
      state.scheduleDates = [];
      state.currentIndex = 0;
      state.stats = { processed: 0, remaining: 0, total: 0 };
      state.failedKeywords = [];
      state.consecutiveFailures = 0;
      state.isRetryPhase = false;
      saveState();
      broadcastState();
    }
    sendResponse(state);
    return;
  }

  if (message.action === 'stop') {
    state.status = 'IDLE';
    isProcessing = false;
    addLog('warning', 'Automation stopped.');
    cleanupAllActiveTabs();
    state.queue = [];
    state.currentIndex = 0;
    state.stats = { processed: 0, remaining: 0, total: 0 };
    state.failedKeywords = [];
    state.consecutiveFailures = 0;
    state.isRetryPhase = false;
    saveState();
    broadcastState();
    sendResponse(state);
    return;
  }

  if (message.action === 'clearLogs') {
    state.logs = [];
    saveState();
    sendResponse(state);
    return;
  }

  if (message.action === 'heartbeat') {
    sendResponse({ status: 'ok' });
    return;
  }
  
  if (message.action === 'settingsUpdated') {
    addLog('info', 'Configuration settings updated.');
    saveState();
    sendResponse({ status: 'ok' });
    return;
  }
});
