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
  isRetryPhase: false,
  activeTabId: null,
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
    state.status = 'PAUSED';
    addLog('warning', 'Service worker restarted. Automation paused. Click resume to continue.');
    saveState();
  }
});

// Watch for manual tab closure
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.activeTabId) {
    state.activeTabId = null;
    if (state.status === 'RUNNING') {
      addLog('warning', 'ChatGPT tab was closed manually. Pausing automation.');
      state.status = 'PAUSED';
      saveState();
      broadcastState();
    }
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
      'actionDelay', 'promptTemplate', 'pinterestPromptTemplate', 'testMode',
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
- 500–600 characters.
- Naturally incorporate 4–5 relevant keywords/long-tail phrases (from the keyword itself and, where applicable, the filtered annotations) — no forced or unnatural insertion.
- Must read naturally, like it's written for humans first, search engines second.

Output strictly in this JSON format, with no extra text before or after:
{
  "title": "Some title",
  "description": "Some description"
}`,
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

// Simple Markdown to HTML Parser
function markdownToHtml(md) {
  if (!md) return '';
  
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let html = [];
  let inList = false;
  let listType = ''; // 'ul' or 'ol'
  let inQuote = false;
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    // Close list if line is not a list item
    const isUnordered = line.startsWith('- ') || line.startsWith('* ');
    const isOrdered = /^\d+\.\s+/.test(line);
    
    if (inList && !isUnordered && !isOrdered && line !== '') {
      html.push(`</${listType}>`);
      inList = false;
    }
    
    // Close blockquote if line is not a quote
    if (inQuote && !line.startsWith('> ')) {
      html.push('</blockquote>');
      inQuote = false;
    }
    
    if (line === '') {
      continue;
    }
    
    // Headers
    if (line.startsWith('# ')) {
      html.push(`<h1>${parseInlineMarkdown(line.substring(2).trim())}</h1>`);
      continue;
    }
    if (line.startsWith('## ')) {
      html.push(`<h2>${parseInlineMarkdown(line.substring(3).trim())}</h2>`);
      continue;
    }
    if (line.startsWith('### ')) {
      html.push(`<h3>${parseInlineMarkdown(line.substring(4).trim())}</h3>`);
      continue;
    }
    if (line.startsWith('#### ')) {
      html.push(`<h4>${parseInlineMarkdown(line.substring(5).trim())}</h4>`);
      continue;
    }
    
    // Blockquote
    if (line.startsWith('> ')) {
      if (!inQuote) {
        html.push('<blockquote>');
        inQuote = true;
      }
      html.push(`<p>${parseInlineMarkdown(line.replace(/^>\s?/, ''))}</p>`);
      continue;
    }
    
    // Unordered List
    if (isUnordered) {
      if (!inList || listType !== 'ul') {
        if (inList) html.push(`</${listType}>`);
        html.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      html.push(`<li>${parseInlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    
    // Ordered List
    if (isOrdered) {
      if (!inList || listType !== 'ol') {
        if (inList) html.push(`</${listType}>`);
        html.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      html.push(`<li>${parseInlineMarkdown(line.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }
    
    // Regular paragraph
    html.push(`<p>${parseInlineMarkdown(line)}</p>`);
  }
  
  // Close any open tags at the end
  if (inList) {
    html.push(`</${listType}>`);
  }
  if (inQuote) {
    html.push('</blockquote>');
  }
  
  return html.join('\n');
}

function parseInlineMarkdown(text) {
  let html = text;
  
  // Escape HTML entities to prevent invalid injection
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
    
  // Bold **text** or __text__
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
  
  // Italic *text* or _text_
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.*?)_/g, '<em>$1</em>');
  
  // Inline code `code`
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');
  
  return html;
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

// Helper to open a tab
function createTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: true }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(tab);
      }
    });
  });
}

// Helper to close the active automation tab
function cleanupActiveTab() {
  if (state.activeTabId) {
    const tabId = state.activeTabId;
    state.activeTabId = null;
    chrome.tabs.remove(tabId, () => {
      if (chrome.runtime.lastError) {
        // Swallowing error if already closed
      }
    });
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
  const endpoint = `${sbUrl}/rest/v1/pin_keywords?id=eq.${kwId}`;
  
  const response = await fetch(endpoint, {
    method: 'PATCH',
    headers: {
      'apikey': settings.sbAnonKey,
      'Authorization': `Bearer ${settings.sbAnonKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ status })
  });

  if (!response.ok) {
    throw new Error(`Supabase patch failed: HTTP ${response.status} ${response.statusText}`);
  }
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

// WordPress Publisher with duplicate-slug protection.
async function publishToWordPress(settings, title, content, slug, scheduleDate = null) {
  const wpUrl = normalizeWpUrl(settings.wpUrl);
  const endpoint = `${wpUrl}/wp-json/wp/v2/posts`;
  
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

    if (duplicateCheck.post) {
      return {
        success: true,
        duplicate: true,
        postId: duplicateCheck.post.id,
        postStatus: duplicateCheck.post.status,
        postLink: duplicateCheck.post.link || ''
      };
    }

    // Attempt 1: Standard JSON payload
    console.log('[AutoAgent] Attempting WordPress publish with JSON payload...');
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
      console.warn(`[AutoAgent] JSON publication returned status ${response.status}. Retrying with urlencoded form-data...`);
      
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
      
      const errorMsg = parsedError && parsedError.message ? parsedError.message : `HTTP status ${response.status}`;
      return { success: false, message: errorMsg };
    }

    const data = await response.json();
    return { success: true, postId: data.id };
  } catch (err) {
    return { success: false, message: err.message || err.toString() };
  }
}

// --- STATE MACHINE ---

let isProcessing = false;

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
        addLog('info', '[Test Mode] Initializing content automation test run...');
        broadcastState();
        
        const rawKws = settings.testKeywords || '';
        const kwList = rawKws.split(/[\n,]/).map(k => k.trim()).filter(Boolean);
        if (kwList.length === 0) {
          kwList.push('High Protein Yogurt Bowl'); // Fallback default
        }
        
        state.queue = kwList.map((kw, i) => ({ id: `test-kw-${i}`, keyword: kw }));
        state.scheduleDates = settings.wpStatus === 'schedule' ? generateScheduleDates(state.queue.length, settings) : [];
        state.currentIndex = 0;
        state.stats.total = state.queue.length;
        state.stats.processed = 0;
        state.stats.remaining = state.queue.length;
        state.failedKeywords = [];
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
          return;
        }
        addLog('info', `Resolved List ID: ${listId}`);
        broadcastState();

        if (settings.automationMode === 'pinterest') {
          addLog('info', `Fetching Pinterest keywords and pre-loading slots (Limit: ${settings.sbBatchLimit})...`);
          broadcastState();
          const rawKeywords = await fetchGrokKeywords(settings, listId);
          
          // Filter in JS to only keep keywords that have active slots requiring copywriting
          const filteredQueue = rawKeywords.map(kw => {
            const pendingSlots = (kw.pin_images || []).filter(s => 
              s.wp_image_url && 
              s.wp_image_url.trim() !== '' && 
              (!s.title || s.title.trim() === '' || !s.description || s.description.trim() === '')
            );
            return {
              id: kw.id,
              keyword: kw.keyword,
              annotation_tags: kw.annotation_tags,
              pendingSlots: pendingSlots
            };
          }).filter(kw => kw.pendingSlots.length > 0);

          if (filteredQueue.length === 0) {
            addLog('warning', 'No Pinterest keywords found with image slots requiring copywriting.');
            state.status = 'IDLE';
            saveState();
            broadcastState();
            return;
          }
          state.queue = filteredQueue;
        } else {
          addLog('info', `Fetching pending and failed keywords (Limit: ${settings.sbBatchLimit})...`);
          broadcastState();
          const keywords = await fetchPendingKeywords(settings, listId);
          if (keywords.length === 0) {
            addLog('warning', 'No pending or failed keywords found to process.');
            state.status = 'IDLE';
            saveState();
            broadcastState();
            return;
          }
          state.queue = keywords;
        }

        if (settings.automationMode === 'article') {
          state.scheduleDates = settings.wpStatus === 'schedule' ? generateScheduleDates(state.queue.length, settings) : [];
        } else {
          state.scheduleDates = [];
        }
        state.currentIndex = 0;
        state.stats.total = state.queue.length;
        state.stats.processed = 0;
        state.stats.remaining = state.queue.length;
        state.failedKeywords = [];
        state.isRetryPhase = false;
        addLog('success', `Queue ready with ${state.queue.length} items.`);
        if (settings.automationMode === 'article' && settings.wpStatus === 'schedule') {
          addLog('info', 'Generated schedules:\n' + state.scheduleDates.map((d, i) => `  - "${state.queue[i].keyword}" -> ${d}`).join('\n'));
        }
        saveState();
        broadcastState();
      }
    }

    // Process keyword at current index
    if (state.currentIndex < state.queue.length) {
      const currentItem = state.queue[state.currentIndex];

      if (settings.automationMode === 'pinterest') {
        const phaseStr = state.isRetryPhase ? '[Retry Phase] ' : '';
        addLog('info', `${phaseStr}Pinterest Copywriter: Processing keyword ${state.currentIndex + 1}/${state.queue.length}: "${currentItem.keyword}"`);
        broadcastState();

        // 1. Fetch active slots
        let activeSlots = [];

        if (settings.testMode) {
          addLog('info', '[Test Mode] Mocking active image slots for testing...');
          activeSlots = [
            { slot_index: 0, wp_image_url: 'https://mocksite.com/uploads/pin1.jpg' },
            { slot_index: 1, wp_image_url: 'https://mocksite.com/uploads/pin2.jpg' }
          ];
        } else {
          addLog('info', `Retrieving pre-loaded active slots for keyword: "${currentItem.keyword}"...`);
          activeSlots = currentItem.pendingSlots || [];
        }

        addLog('info', `Found ${activeSlots.length} slot(s) requiring copywriting.`);
        broadcastState();

        if (activeSlots.length === 0) {
          addLog('warning', `No slots requiring copywriting (either empty or already completed) for keyword: "${currentItem.keyword}". Skipping.`);
          state.stats.processed++;
          state.stats.remaining = state.queue.length - state.stats.processed;
        } else {
          // 2. Open Grok tab
          cleanupActiveTab();
          const tab = await createTab('https://grok.com/');
          state.activeTabId = tab.id;
          saveState();
          broadcastState();

          addLog('info', 'Waiting for Grok page to respond...');
          broadcastState();
          const scriptReady = await waitForContentScriptReady(tab.id);
          if (!scriptReady) {
            throw new Error('Grok page content script response timeout.');
          }

          // 3. Process each slot
          for (let sIndex = 0; sIndex < activeSlots.length; sIndex++) {
            const slot = activeSlots[sIndex];
            addLog('info', `Processing Slot ${slot.slot_index + 1}/${activeSlots.length} (Index: ${slot.slot_index})...`);
            broadcastState();

            // Construct prompt
            const annotations = Array.isArray(currentItem.annotation_tags) ? currentItem.annotation_tags.join(', ') : '';
            const promptText = settings.pinterestPromptTemplate
              .replace(/{keyword}/gi, currentItem.keyword)
              .replace(/{annotations}/gi, annotations);

            addLog('info', `Submitting prompt for Slot ${slot.slot_index + 1}...`);
            broadcastState();

            if (state.status !== 'RUNNING') return;

            const promptResult = await sendMessageToTab(tab.id, { action: 'enterPrompt', prompt: promptText });
            if (promptResult.status !== 'success') {
              throw new Error(`Failed to type/submit prompt: ${promptResult.message || 'unknown error'}`);
            }

            addLog('info', `Waiting for Slot ${slot.slot_index + 1} copywriting generation...`);
            broadcastState();

            if (state.status !== 'RUNNING') return;

            try {
              await pollGenerationComplete(tab.id, 600000);
            } catch (pollErr) {
              throw new Error(`Generation error: ${pollErr.message}`);
            }

            addLog('info', 'Generation complete. Scraping response content...');
            broadcastState();

            if (state.status !== 'RUNNING') return;

            const extractResult = await sendMessageToTab(tab.id, { action: 'extractContent' });
            if (extractResult.status !== 'success') {
              throw new Error(`Extraction failed: ${extractResult.message}`);
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
              addLog('error', `Grok response did not contain a valid JSON title and description for Slot ${slot.slot_index + 1}. Raw text: ${rawText.substring(0, 150)}...`);
              throw new Error('Failed to parse JSON containing title and description from Grok response.');
            }

            const pinTitle = parsed.title.trim();
            const pinDesc = parsed.description.trim();

            addLog('success', `Generated Pin Copy for Slot ${slot.slot_index + 1}:\nTitle: "${pinTitle}"\nDescription: "${pinDesc}"`);
            broadcastState();

            if (settings.testMode) {
              addLog('info', `[Test Mode] Bypassing Supabase database update. Downloading result as JSON...`);
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
              addLog('info', `Updating slot row in Supabase...`);
              await updatePinImageSlot(settings, currentItem.id, slot.slot_index, pinTitle, pinDesc);
              addLog('success', `Supabase slot row updated successfully.`);
            }

            // Cooldown delay between multiple slots for the same keyword
            if (sIndex < activeSlots.length - 1) {
              addLog('info', `Waiting for slot cooldown delay of ${settings.actionDelay}s...`);
              await delay(settings.actionDelay * 1000);
            }
          }

          // Completed copywriting for all slots of this keyword

          state.stats.processed++;
          state.stats.remaining = state.queue.length - state.stats.processed;
        }

        // Clean up and proceed
        cleanupActiveTab();
        state.currentIndex++;
        saveState();
        broadcastState();

        if (state.currentIndex < state.queue.length) {
          addLog('info', `Waiting for keyword cooldown delay of ${settings.actionDelay}s...`);
          await delay(settings.actionDelay * 1000);
          runStateMachine(true);
        } else {
          runStateMachine(true);
        }
        return;
      }

      const phaseStr = state.isRetryPhase ? '[Retry Phase] ' : '';
      
      addLog('info', `${phaseStr}Processing keyword ${state.currentIndex + 1}/${state.queue.length}: "${currentItem.keyword}"`);
      broadcastState();

      // Spawn single Grok tab
      cleanupActiveTab(); // safety
      const tab = await createTab('https://grok.com/');
      state.activeTabId = tab.id;
      saveState();
      broadcastState();

      // Wait for content script load
      addLog('info', 'Waiting for Grok page to respond...');
      broadcastState();
      const scriptReady = await waitForContentScriptReady(tab.id);
      if (!scriptReady) {
        throw new Error('Grok page content script response timeout.');
      }

      // Fill prompt
      const formattedPrompt = settings.promptTemplate.replace(/{keyword}/gi, currentItem.keyword)
        + '\n\nIMPORTANT: Do not attach the article as a file, document, or download block. You must write the entire article directly in the chat message response.';
      addLog('info', 'Submitting prompt...');
      broadcastState();
      
      if (state.status !== 'RUNNING') return; // handle user pause/stop
      
      const promptResult = await sendMessageToTab(tab.id, { action: 'enterPrompt', prompt: formattedPrompt });
      if (promptResult.status !== 'success') {
        throw new Error(`Failed to type/submit prompt: ${promptResult.message || 'unknown error'}`);
      }

      // Wait for generation complete with 90s safety timeout
      addLog('info', 'Article generation streaming... waiting for completion.');
      broadcastState();
      
      if (state.status !== 'RUNNING') return;
      
      try {
        await pollGenerationComplete(tab.id, 600000);
      } catch (pollErr) {
        throw new Error(`Generation error: ${pollErr.message}`);
      }

      // Extract output HTML
      addLog('info', 'Generation complete. Scraping article content...');
      broadcastState();
      
      if (state.status !== 'RUNNING') return;
      
      const extractResult = await sendMessageToTab(tab.id, { action: 'extractContent' });
      if (extractResult.status !== 'success') {
        throw new Error(`Extraction failed: ${extractResult.message}`);
      }
      
      const articleHtml = extractResult.content;
      const articleMarkdown = extractResult.markdown;
      const grokPreview = articleMarkdown.split('\n').filter(l => l.trim()).slice(0, 6).join('\n');
      addLog('success', `Scraped Grok Article Preview:\n${grokPreview}`);
      broadcastState();

      // 1. Always extract the catchy title and split Grok's output into title/intro/body
      const parsedMd = parseGrokOutput(articleMarkdown);
      const parsedHtml = parseHtmlGrokOutput(articleHtml);
      
      let finalTitle = currentItem.keyword;
      if (parsedMd.title || parsedHtml.title) {
        finalTitle = parsedMd.title || parsedHtml.title;
        addLog('info', `Extracted catchy title from Grok: "${finalTitle}"`);
      }

      // 2. Default content is the Grok article stripped of the title
      let finalMarkdown = `${parsedMd.intro}\n\n${parsedMd.body}`.trim();
      let finalHtml = `${parsedHtml.intro}\n\n${parsedHtml.body}`.trim();
      let newIntroHtml = '';
      let newIntroMarkdown = '';

      // Handle Custom GPT Intro rewrite if configured
      if (settings.gptRewrite && settings.customGptUrl) {
        addLog('info', `Navigating to Custom GPT URL: ${settings.customGptUrl}`);
        broadcastState();

        // Clean up Grok tab and open GPT
        cleanupActiveTab();
        const gptTab = await createTab(settings.customGptUrl);
        state.activeTabId = gptTab.id;
        saveState();
        broadcastState();

        addLog('info', 'Waiting for Custom GPT page to respond...');
        broadcastState();
        const gptReady = await waitForContentScriptReady(gptTab.id);
        if (!gptReady) {
          throw new Error('Custom GPT content script response timeout.');
        }

        // Wiggle room for custom GPT assets to load
        await new Promise(r => setTimeout(r, 4000));

        addLog('info', `Submitting raw keyword: "${currentItem.keyword}"...`);
        broadcastState();
        const promptResult = await sendMessageToTab(gptTab.id, { action: 'enterPrompt', prompt: currentItem.keyword });
        if (promptResult.status !== 'success') {
          throw new Error(`Failed to submit keyword to Custom GPT: ${promptResult.message}`);
        }

        addLog('info', 'Custom GPT intro generation streaming and waiting for compilation...');
        broadcastState();
        try {
          await pollGptIntroComplete(gptTab.id, 600000);
        } catch (pollErr) {
          throw new Error(`Custom GPT generation failed: ${pollErr.message}`);
        }

        const extractResult = await sendMessageToTab(gptTab.id, { action: 'waitForGptIntro' });
        if (extractResult.status !== 'success') {
          throw new Error(`Custom GPT extraction failed: ${extractResult.message}`);
        }

        newIntroHtml = extractResult.content;
        newIntroMarkdown = extractResult.markdown;

        // Verify intro length
        const wordCount = newIntroMarkdown.split(/\s+/).filter(Boolean).length;
        addLog('success', `Extracted intro (${wordCount} words): "${newIntroMarkdown.substring(0, 80).replace(/\n/g, ' ')}..."`);
        broadcastState();

        if (wordCount < 15) {
          throw new Error(`Custom GPT introduction was too short or empty (${wordCount} words).`);
        }

        addLog('success', 'Splicing new introduction with original body...');
        broadcastState();

        // Final Splice (intro + body, listicle gets inserted below if enabled)
        finalMarkdown = `${newIntroMarkdown}\n\n${parsedMd.body}`.trim();
        finalHtml = `${newIntroHtml}\n\n${parsedHtml.body}`.trim();

        // Clean up GPT tab
        cleanupActiveTab();
      }

      // Handle Listicle GPT section if configured
      if (settings.listicle && settings.listicleGptUrl) {
        addLog('info', `Listicle Mode enabled. Navigating to Listicle GPT: ${settings.listicleGptUrl}`);
        broadcastState();

        if (state.status !== 'RUNNING') return;

        const listicleTab = await createTab(settings.listicleGptUrl);
        state.activeTabId = listicleTab.id;
        saveState();
        broadcastState();

        addLog('info', 'Waiting for Listicle GPT page to respond...');
        broadcastState();
        const listicleReady = await waitForContentScriptReady(listicleTab.id);
        if (!listicleReady) {
          throw new Error('Listicle GPT content script response timeout.');
        }

        // Wiggle room for custom GPT assets to load
        await new Promise(r => setTimeout(r, 4000));

        addLog('info', `Submitting raw keyword to Listicle GPT: "${currentItem.keyword}"...`);
        broadcastState();

        if (state.status !== 'RUNNING') return;

        const listiclePromptResult = await sendMessageToTab(listicleTab.id, { action: 'enterPrompt', prompt: currentItem.keyword });
        if (listiclePromptResult.status !== 'success') {
          throw new Error(`Failed to submit keyword to Listicle GPT: ${listiclePromptResult.message}`);
        }

        addLog('info', 'Listicle GPT generation streaming and waiting for compilation...');
        broadcastState();
        try {
          await pollGptIntroComplete(listicleTab.id, 600000);
        } catch (pollErr) {
          throw new Error(`Listicle GPT generation failed: ${pollErr.message}`);
        }

        const extractResult = await sendMessageToTab(listicleTab.id, { action: 'waitForGptIntro' });
        if (extractResult.status !== 'success') {
          throw new Error(`Listicle GPT extraction failed: ${extractResult.message}`);
        }

        const listicleSectionHtml = extractResult.content;
        const listicleSectionMarkdown = extractResult.markdown;

        // Verify listicle section length
        const listicleWordCount = listicleSectionMarkdown.split(/\s+/).filter(Boolean).length;
        if (listicleWordCount < 15) {
          throw new Error(`Listicle GPT section was too short or empty (${listicleWordCount} words).`);
        }

        addLog('success', `Listicle section extracted (${listicleWordCount} words). Splicing after intro...`);
        broadcastState();

        // Re-splice: insert listicle section between intro and body
        if (settings.gptRewrite && settings.customGptUrl) {
          // We already have parsed pieces — reconstruct with listicle in between
          finalMarkdown = `${newIntroMarkdown}\n\n${listicleSectionMarkdown}\n\n${parsedMd.body}`.trim();
          finalHtml = `${newIntroHtml}\n\n${listicleSectionHtml}\n\n${parsedHtml.body}`.trim();
        } else {
          // No intro rewrite — parse the original article and insert listicle after its intro
          finalMarkdown = `${parsedMd.intro}\n\n${listicleSectionMarkdown}\n\n${parsedMd.body}`.trim();
          finalHtml = `${parsedHtml.intro}\n\n${listicleSectionHtml}\n\n${parsedHtml.body}`.trim();
        }

        // Clean up Listicle GPT tab
        cleanupActiveTab();
      }
      
      if (settings.testMode) {
        const scheduleDate = state.scheduleDates && state.scheduleDates[state.currentIndex] ? state.scheduleDates[state.currentIndex] : null;
        addLog('info', '[Test Mode] Bypassing WordPress/Supabase. Downloading generated content as Markdown file...');
        broadcastState();

        const safeKw = finalTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const dateSuffix = scheduleDate ? `-${scheduleDate.replace(/[:]/g, '_')}` : '';
        chrome.downloads.download({
          url: 'data:text/markdown;charset=utf-8,' + encodeURIComponent(finalMarkdown),
          filename: `test-article-${safeKw}${dateSuffix}.md`,
          saveAs: false
        }, (downloadId) => {
          if (chrome.downloads.lastError) {
            addLog('error', `[Test Mode] Download failed: ${chrome.downloads.lastError.message}`);
          } else {
            const schedMsg = scheduleDate ? ` (simulated schedule: ${scheduleDate})` : '';
            addLog('success', `[Test Mode] Markdown document downloaded successfully${schedMsg}. ID: ${downloadId}`);
          }
          broadcastState();
        });

        // Update counters
        state.stats.processed++;
        state.stats.remaining = state.queue.length - state.stats.processed;
      } else {
        // Publish to WordPress
        const scheduleDate = state.scheduleDates && state.scheduleDates[state.currentIndex] ? state.scheduleDates[state.currentIndex] : null;
        if (scheduleDate) {
          addLog('info', `Publishing to WordPress (scheduled for: ${scheduleDate})...`);
        } else {
          addLog('info', `Publishing to WordPress as "${settings.wpStatus}"...`);
        }
        broadcastState();
        
        if (state.status !== 'RUNNING') return;
        
        const slug = sanitizeSlug(currentItem.keyword) || sanitizeSlug(finalTitle);
        addLog('info', `Checking WordPress for existing slug: "${slug}"...`);
        broadcastState();

        const wpResult = await publishToWordPress(settings, finalTitle, finalHtml, slug, scheduleDate);
        if (!wpResult.success) {
          throw new Error(`WordPress publishing failed: ${wpResult.message}`);
        }
        if (wpResult.duplicate) {
          addLog('warning', `Existing WordPress post found. Duplicate creation skipped. ID: ${wpResult.postId}, status: ${wpResult.postStatus || 'unknown'}.`);
        } else {
          addLog('success', `Post published to WordPress! ID: ${wpResult.postId}`);
        }
        broadcastState();

        // Update status in Supabase
        addLog('info', 'Updating Supabase status to completed...');
        broadcastState();
        await updateKeywordStatus(settings, currentItem.id, 'completed');
        addLog('success', `Supabase updated successfully.`);
        broadcastState();

        // Update counters
        state.stats.processed++;
        state.stats.remaining = state.queue.length - state.stats.processed;
      }

    } else {
      // Index reached the end of queue. Check if retry is needed.
      if (state.failedKeywords.length > 0 && !state.isRetryPhase) {
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

        // Wait cooldown and loop back
        addLog('info', `Waiting for cooldown delay of ${settings.actionDelay}s...`);
        await delay(settings.actionDelay * 1000);
        runStateMachine(true);
        return;
      } else {
        // Complete
        addLog('success', 'All automation tasks completed successfully!');
        state.status = 'COMPLETED';
        state.queue = [];
        state.currentIndex = 0;
        cleanupActiveTab();
        saveState();
        broadcastState();
        isProcessing = false;
        return;
      }
    }

    // Keyword finished successfully, transition to next
    cleanupActiveTab();
    state.currentIndex++;
    state.stats.remaining = state.queue.length - state.currentIndex;
    saveState();
    broadcastState();

    if (state.currentIndex < state.queue.length) {
      addLog('info', `Waiting for cooldown delay of ${settings.actionDelay}s...`);
      await delay(settings.actionDelay * 1000);
      runStateMachine(true);
    } else {
      runStateMachine(true);
    }

  } catch (err) {
    addLog('error', err.message);
    
    // If the queue is empty, the error happened during initialization (e.g. database connection or query error)
    if (!state.queue || state.queue.length === 0) {
      addLog('error', 'Automation aborted during initialization phase.');
      state.status = 'IDLE';
      isProcessing = false;
      saveState();
      broadcastState();
      return;
    }

    // Fail current keyword
    if (state.queue && state.queue[state.currentIndex]) {
      const failedItem = state.queue[state.currentIndex];
      
      try {
        const settings = await getSettings();
        if (settings.automationMode !== 'pinterest') {
          await updateKeywordStatus(settings, failedItem.id, 'failed');
          addLog('warning', `Marked keyword "${failedItem.keyword || failedItem.id}" as failed in Supabase.`);
        }
      } catch (dbErr) {
        addLog('error', `Failed to mark status in database: ${dbErr.message}`);
      }

      if (!state.isRetryPhase) {
        state.failedKeywords.push(failedItem);
      }
    }

    // Cooldown and proceed
    cleanupActiveTab();
    state.currentIndex++;
    state.stats.remaining = state.queue.length - state.currentIndex;
    saveState();
    broadcastState();

    const settings = await getSettings();
    if (state.currentIndex < state.queue.length) {
      addLog('info', `Waiting for cooldown delay of ${settings.actionDelay}s...`);
      await delay(settings.actionDelay * 1000);
      runStateMachine(true);
    } else {
      runStateMachine(true);
    }
  }
}

// --- MESSAGE ROUTER ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      state.status = 'RUNNING';
      addLog('info', 'Resuming automation.');
      saveState();
      runStateMachine();
    } else {
      // New batch
      state.status = 'RUNNING';
      state.queue = [];
      state.currentIndex = 0;
      state.stats = { processed: 0, remaining: 0, total: 0 };
      state.failedKeywords = [];
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
      addLog('warning', 'Automation paused.');
      cleanupActiveTab();
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
    cleanupActiveTab();
    state.queue = [];
    state.currentIndex = 0;
    state.stats = { processed: 0, remaining: 0, total: 0 };
    state.failedKeywords = [];
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
