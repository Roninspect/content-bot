// Grok & ChatGPT Automation Content Script
console.log('[AutoAgent] Content script injected on host:', window.location.hostname);

const isGrok = window.location.hostname.includes('grok.com');

// Heartbeat keepalive with the service worker. An extension reload permanently
// invalidates this page's old content-script context, so stop the timer instead
// of throwing "Extension context invalidated" every five seconds.
let heartbeatInterval = null;

function stopHeartbeat() {
  if (heartbeatInterval !== null) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function sendHeartbeat() {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id || !chrome.runtime.sendMessage) {
      stopHeartbeat();
      return;
    }

    chrome.runtime.sendMessage({ action: 'heartbeat' }, () => {
      try {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError && /extension context invalidated/i.test(runtimeError.message || '')) {
          stopHeartbeat();
        }
      } catch (err) {
        stopHeartbeat();
      }
    });
  } catch (err) {
    stopHeartbeat();
  }
}

heartbeatInterval = setInterval(sendHeartbeat, 5000);

// React-controlled input setter workaround helper
function setReactInputValue(el, val) {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    try {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
                                  || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(el, val);
    } catch (e) {
      el.value = val;
    }
  } else if (el.getAttribute('contenteditable') === 'true') {
    el.innerHTML = `<p>${val}</p>`;
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
}

// Fallback chain selector for input textbox
function findInputBox() {
  if (isGrok) {
    return document.querySelector('div[contenteditable="true"][aria-label*="Grok"]')
        || document.querySelector('div[contenteditable="true"][role="textbox"]')
        || document.querySelector('div[contenteditable="true"]')
        || document.querySelector('textarea');
  } else {
    // ChatGPT Selectors
    return document.querySelector('textarea#prompt-textarea')
        || document.querySelector('#prompt-textarea')
        || document.querySelector('div[contenteditable="true"]')
        || document.querySelector('textarea');
  }
}

// Fallback chain selector for send button
function findSendButton() {
  if (isGrok) {
    return document.querySelector('button[data-testid="chat-submit"]')
        || document.querySelector('button[aria-label="Submit"]')
        || document.querySelector('button[aria-label*="voice"]')
        || document.querySelector('button[aria-label*="Voice"]')
        || document.querySelector('form button[type="submit"]');
  } else {
    // ChatGPT Selectors
    const btn = document.querySelector('button[data-testid="send-button"]')
             || document.querySelector('button[aria-label="Send prompt"]')
             || document.querySelector('button[aria-label*="voice" i]')
             || document.querySelector('button[aria-label*="Voice" i]')
             || document.querySelector('#composer-submit-button');

    if (btn) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
      if (label.includes('stop') || label.includes('generating') || label.includes('answering') || testId.includes('stop')) {
        return null;
      }
    }
    return btn;
  }
}

// Fallback chain selector for stop button
function findStopButton() {
  if (isGrok) {
    const stopBtn = document.querySelector('button[aria-label*="Stop" i]')
                 || document.querySelector('button[aria-label*="Cancel" i]')
                 || document.querySelector('button[data-testid*="stop" i]');
    if (stopBtn) return stopBtn;

    // Check if the submit button is in stop/generating mode
    const submitBtn = document.querySelector('button[data-testid="chat-submit"]') || document.querySelector('button[aria-label="Submit"]');
    if (submitBtn) {
      if (submitBtn.querySelector('rect') || (submitBtn.getAttribute('aria-label') || '').toLowerCase().includes('stop')) {
        return submitBtn;
      }
    }
    return null;
  } else {
    // ChatGPT Selectors
    const stopBtn = document.querySelector('button[data-testid="stop-button"]')
                 || document.querySelector('button[aria-label="Stop answering"]')
                 || document.querySelector('button[aria-label*="stop" i]')
                 || document.querySelector('button[aria-label="Stop generating"]')
                 || document.querySelector('button[aria-label="Stop"]')
                 || document.querySelector('#composer-submit-button');

    if (stopBtn) {
      const label = (stopBtn.getAttribute('aria-label') || '').toLowerCase();
      const testId = (stopBtn.getAttribute('data-testid') || '').toLowerCase();
      if (label.includes('stop') || label.includes('generating') || label.includes('answering') || testId.includes('stop')) {
        return stopBtn;
      }
    }
    return null;
  }
}

function isVisibleElement(element) {
  if (!element || !element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

// Dedicated helper to locate the latest genuine message-level Copy button.
function findCopyButton(container) {
  // 1. Direct Grok "Copy response" button check (highest accuracy)
  if (isGrok) {
    const directGrokButtons = Array.from(document.querySelectorAll(
      '.last-response button[aria-label*="Copy response" i], button[aria-label="Copy response" i], button[aria-label*="Copy response" i]'
    )).filter(button => !button.closest('pre, code, [class*="code"]') && isVisibleElement(button));
    const directGrokBtn = directGrokButtons[directGrokButtons.length - 1];
    if (directGrokBtn) return directGrokBtn;
  }

  if (!container) return null;
  const parentMessage = container.closest('[data-testid*="message"], [class*="message-row"], [class*="response"], [class*="chat-message"]') 
                     || container.closest('[class*="message"]') 
                     || container.parentElement 
                     || container;

  // 2. Look in message action bars / footers (bottom of message)
  const actionBars = parentMessage.querySelectorAll('[class*="action"], [class*="toolbar"], [class*="footer"], [class*="bottom"]');
  for (const bar of Array.from(actionBars).reverse()) {
    if (bar.closest('pre, code, [class*="code"], [class*="syntax"]')) continue;

    const copyBtn = bar.querySelector('button[aria-label*="Copy response" i]')
                 || bar.querySelector('button[aria-label="Copy" i]')
                 || bar.querySelector('button[aria-label*="Copy" i]')
                 || bar.querySelector('button[data-testid*="copy" i]')
                 || bar.querySelector('button[title*="Copy" i]');
    if (copyBtn) return copyBtn;
  }

  // 3. Search all buttons inside message excluding code block containers
  const allButtons = Array.from(parentMessage.querySelectorAll('button')).filter(b => {
    return !b.closest('pre, code, [class*="code"], [class*="syntax"]');
  });

  const messageCopyBtn = allButtons.reverse().find(b => {
    const label = (b.getAttribute('aria-label') || '').toLowerCase();
    const testId = (b.getAttribute('data-testid') || '').toLowerCase();
    const title = (b.getAttribute('title') || '').toLowerCase();
    return (label.includes('copy') || testId.includes('copy') || title.includes('copy')) && !label.includes('code');
  });

  if (messageCopyBtn) return messageCopyBtn;

  // 4. Fallback: Search the document for the last non-code copy button
  if (isGrok) {
    const grokButtons = Array.from(document.querySelectorAll('button')).filter(b => {
      if (b.closest('pre, code, [class*="code"]')) return false;
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const title = (b.getAttribute('title') || '').toLowerCase();
      return (label.includes('copy') || title.includes('copy')) && !label.includes('code');
    });
    if (grokButtons.length > 0) {
      return grokButtons[grokButtons.length - 1];
    }
  }

  return null;
}

// Locate the last assistant response container (for standard chats)
function findLastAssistantResponse() {
  if (isGrok) {
    const messageRows = document.querySelectorAll('[data-testid*="message-row"], [class*="message-row"], [class*="response-container"], [data-testid*="message"]');
    if (messageRows.length > 0) {
      return messageRows[messageRows.length - 1];
    }

    const genericBlocks = document.querySelectorAll('[class*="message-bubble"], [class*="response"], [class*="bubble"]');
    if (genericBlocks.length > 0) {
      return genericBlocks[genericBlocks.length - 1];
    }

    const blocks = document.querySelectorAll('.markdown, .message-content, [data-testid="message-content"], [class*="message-text"], [class*="message-body"]');
    if (blocks.length > 0) {
      const lastBlock = blocks[blocks.length - 1];
      return lastBlock.closest('[class*="message"], [class*="bubble"], [class*="response"]') || lastBlock.parentElement || lastBlock;
    }
    return null;
  } else {
    // ChatGPT: Standard inline bubble check
    const assistants = document.querySelectorAll('div[data-message-author-role="assistant"]');
    if (assistants.length > 0) {
      return assistants[assistants.length - 1];
    }
    const markdownBlocks = document.querySelectorAll('.markdown.prose, .prose');
    if (markdownBlocks.length > 0) {
      const lastMd = markdownBlocks[markdownBlocks.length - 1];
      return lastMd.closest('div[data-message-author-role="assistant"]') || lastMd;
    }
    return null;
  }
}

// Locate ChatGPT Writing Block / Canvas Copy Button
function getWritingBlockCopyButton() {
  if (isGrok) return null;
  
  // Find all Canvas container blocks
  const containers = document.querySelectorAll('[data-testid="writing-block-container"]')
                  || document.querySelectorAll('[data-writing-block="true"]');
  if (containers.length === 0) return null;
  
  // Scope search to the last (newest) active Canvas card
  const container = containers[containers.length - 1];
  const header = container.querySelector('[data-testid="writing-block-header-surface"]')
              || container.querySelector('[class*="header"]')
              || container.querySelector('div[class*="flex"]');
  if (!header) return null;
  
  return header.querySelector('button[aria-label="Copy" i]')
      || header.querySelector('button[aria-label*="Copy" i]')
      || header.querySelector('button[data-testid*="copy" i]');
}

// Locate ChatGPT Writing Block editor content container
function getWritingBlockContentContainer() {
  if (isGrok) return null;
  
  const containers = document.querySelectorAll('[data-testid="writing-block-container"]')
                  || document.querySelectorAll('[data-writing-block="true"]');
  if (containers.length === 0) return null;
  
  const container = containers[containers.length - 1];
  return container.querySelector('[data-writing-block-fullscreen-editor-region="true"]')
      || container.querySelector('.ProseMirror')
      || container.querySelector('[contenteditable="true"]')
      || container.querySelector('[class*="editor"]');
}

function requestClipboardFocus(force = false) {
  return new Promise((resolve, reject) => {
    try {
      if (!force && document.hasFocus()) {
        resolve(true);
        return;
      }

      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        reject(new Error('Extension context invalidated while requesting clipboard focus.'));
        return;
      }

      chrome.runtime.sendMessage({ action: 'requestClipboardFocus' }, (response) => {
        try {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
            return;
          }
          if (!response || response.status !== 'success') {
            reject(new Error(response?.message || 'Background could not focus the clipboard tab.'));
            return;
          }
          setTimeout(() => resolve(document.hasFocus()), 250);
        } catch (err) {
          reject(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function ensureClipboardFocus(attemptLabel) {
  while (!document.hasFocus()) {
    console.log(`[AutoAgent] ${attemptLabel}: requesting clipboard focus...`);
    const focused = await requestClipboardFocus();
    if (!focused) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

async function readFreshClipboard(attemptLabel) {
  while (true) {
    await ensureClipboardFocus(attemptLabel);
    try {
      return await navigator.clipboard.readText();
    } catch (err) {
      const errorText = `${err.name || ''} ${err.message || ''}`;
      if (/not focused|document is not focused|notallowederror/i.test(errorText)) {
        console.warn(`[AutoAgent] ${attemptLabel}: clipboard read lost focus. Refocusing before reading again...`);
        await requestClipboardFocus(true);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      throw err;
    }
  }
}

async function copyButtonToFreshClipboard(button, attemptLabel) {
  const markerId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
  const clipboardMarker = `__AUTOAGENT_COPY_PENDING_${markerId}__`;

  // Replace any previous clipboard value first. If Grok shows a Copy error and does
  // not write anything, this marker remains and stale/unrelated content is rejected.
  while (true) {
    await ensureClipboardFocus(attemptLabel);
    try {
      await navigator.clipboard.writeText(clipboardMarker);
      break;
    } catch (err) {
      const errorText = `${err.name || ''} ${err.message || ''}`;
      if (!/not focused|document is not focused|notallowederror/i.test(errorText)) throw err;
      console.warn(`[AutoAgent] ${attemptLabel}: clipboard marker write lost focus. Refocusing before trying again...`);
      await requestClipboardFocus(true);
      await new Promise(r => setTimeout(r, 500));
    }
  }
  button.focus();
  button.click();

  // Grok can show its clipboard-error toast asynchronously. Give the Copy action
  // 2.5 seconds to complete before checking whether it replaced our marker.
  await new Promise(r => setTimeout(r, 2500));

  // The page can lose focus after the click. Ask the background worker to refocus
  // this same tab, then read the result without clicking Copy a second time first.
  const copiedText = await readFreshClipboard(attemptLabel);
  const normalizedText = copiedText ? copiedText.trim() : '';
  if (!normalizedText || normalizedText === clipboardMarker || normalizedText.length < 20) {
    console.warn(`[AutoAgent] ${attemptLabel} did not replace the clipboard marker.`);
    return '';
  }

  return normalizedText;
}

function createFatalCopyError(label) {
  const error = new Error(`${label} failed twice consecutively. Stopping automation to prevent unwanted content.`);
  error.stopAutomation = true;
  return error;
}

// Copy-button-only extraction. The button may take any amount of time to appear,
// but two consecutive failed Copy/clipboard attempts stop the automation.
async function copyStandardAssistantContent(assistantNode) {
  let attempt = 0;
  let consecutiveCopyProblems = 0;

  while (true) {
    attempt++;
    const btn = findCopyButton(assistantNode);

    if (btn) {
      try {
        await ensureClipboardFocus(`Copy attempt ${attempt}`);
        console.log(`[AutoAgent] Clicking standard copy button (attempt ${attempt})...`);
        window.focus();
        const text = await copyButtonToFreshClipboard(btn, `Copy attempt ${attempt}`);
        if (text) {
          const copiedWordCount = text.split(/\s+/).filter(Boolean).length;
          console.log(`[AutoAgent] Successfully extracted ${copiedWordCount} words via native copy button.`);
          return text;
        }
        consecutiveCopyProblems++;
      } catch (err) {
        if (err.stopAutomation) throw err;
        consecutiveCopyProblems++;
        console.warn(`[AutoAgent] Copy button clipboard read attempt ${attempt} failed: ${err.message}`);
      }

      if (consecutiveCopyProblems >= 2) {
        throw createFatalCopyError('Native Copy button extraction');
      }
    } else {
      console.log(`[AutoAgent] Waiting for the latest Copy response button (attempt ${attempt})...`);
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

// Debounced writing block observer with parallel poller timer and 3s inline bubble fallback
function waitForWritingBlock(onReady, onFallbackInline, onError, timeoutMs = 600000) {
  const start = Date.now();
  let debounceTimer;

  const check = () => {
    const editor = getWritingBlockContentContainer();
    const copyBtn = getWritingBlockCopyButton();

    if (editor && copyBtn) {
      const sendBtn = findSendButton();
      const stopBtn = findStopButton();

      // Guard: Only allow button-state completion checks if at least 3 seconds have passed
      // to let the prompt submission register and the interface transition into "generating" state.
      if (Date.now() - start > 3000) {
        if (sendBtn && !sendBtn.disabled && !stopBtn) {
          console.log('[AutoAgent] Canvas completion detected via active send button.');
          clearInterval(pollTimer);
          obs.disconnect();
          const header = copyBtn.parentElement || document.body;
          onReady(header, editor);
          return;
        }
      }

      // Settle timer fallback in case buttons aren't accessible
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log('[AutoAgent] Canvas completion detected via settle timer.');
        clearInterval(pollTimer);
        obs.disconnect();
        const header = copyBtn.parentElement || document.body;
        onReady(header, editor);
      }, 1500);
      return;
    }

    // Inline Fallback: If standard chat bubble exists and generation completed without Canvas appearing
    const assistants = document.querySelectorAll('div[data-message-author-role="assistant"]');
    if (assistants.length > 0) {
      const lastAssistant = assistants[assistants.length - 1];
      const sendBtn = findSendButton();
      const stopBtn = findStopButton();
      
      // Fall back if generation is complete (send button active and stop button absent)
      // and we are past a 5-second initial rendering window
      if (sendBtn && !sendBtn.disabled && !stopBtn && (Date.now() - start > 5000)) {
        console.log('[AutoAgent] Canvas did not appear. Falling back to inline assistant bubble.');
        clearInterval(pollTimer);
        obs.disconnect();
        onFallbackInline(lastAssistant);
        return;
      }
    }

    // Timeout Check
    if (Date.now() - start > timeoutMs) {
      clearInterval(pollTimer);
      obs.disconnect();
      onError(new Error('Writing block / assistant response did not appear within 10 minutes'));
    }
  };

  const obs = new MutationObserver(check);
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });

  // Parallel poller ensures the timeout and fallback check evaluates even on DOM idle state
  const pollTimer = setInterval(check, 500);
  check();
}

// Canvas Copy-button-only extraction with the same two-problem safety limit.
async function copyWritingBlockContent(header, editor) {
  let attempt = 0;
  let consecutiveCopyProblems = 0;

  while (true) {
    attempt++;
    const btn = getWritingBlockCopyButton();
             
    if (btn) {
      try {
        await ensureClipboardFocus(`Canvas Copy attempt ${attempt}`);
        console.log(`[AutoAgent] Clicking Canvas copy button (attempt ${attempt})...`);
        window.focus();
        const text = await copyButtonToFreshClipboard(btn, `Canvas Copy attempt ${attempt}`);
        if (text) {
          return text;
        }
        consecutiveCopyProblems++;
      } catch (err) {
        if (err.stopAutomation) throw err;
        consecutiveCopyProblems++;
        console.warn(`[AutoAgent] Canvas copy button clipboard read attempt ${attempt} failed: ${err.message}`);
      }

      if (consecutiveCopyProblems >= 2) {
        throw createFatalCopyError('Canvas Copy button extraction');
      }
    } else {
      console.log(`[AutoAgent] Waiting for Canvas Copy button (attempt ${attempt})...`);
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

// Consolidates wait and extraction for Custom GPT intro rewrites
function getNewIntro() {
  return new Promise((resolve, reject) => {
    waitForWritingBlock(
      async (header, editor) => {
        try {
          const intro = await copyWritingBlockContent(header, editor);
          resolve({ content: editor.innerHTML, markdown: intro });
        } catch (err) {
          reject(err);
        }
      },
      async (fallbackContainer) => {
        try {
          const introText = await copyStandardAssistantContent(fallbackContainer);
          resolve({
            content: fallbackContainer.innerHTML,
            markdown: introText
          });
        } catch (err) {
          reject(err);
        }
      },
      (err) => {
        reject(err);
      }
    );
  });
}

// Check if user is logged out
function checkAuthStatus() {
  const input = findInputBox();
  if (!input) {
    const pageText = document.body.innerText.toLowerCase();
    if (pageText.includes('sign in') || pageText.includes('log in') || pageText.includes('login') || pageText.includes('welcome to grok') || pageText.includes('welcome to chatgpt')) {
      return { loggedIn: false, error: `Logged out. Please log into ${isGrok ? 'Grok' : 'ChatGPT'} first.` };
    }
  }
  return { loggedIn: true };
}

// Check for captcha or rate limit screens
function checkBlockStatus() {
  const pageText = document.body.innerText;
  
  // CAPTCHA checks
  if (pageText.includes('Verify you are human') || pageText.includes('verification challenge') || document.querySelector('iframe[src*="cloudflare"]')) {
    return { status: 'error', type: 'captcha', message: `CAPTCHA or human verification check detected on ${isGrok ? 'Grok' : 'ChatGPT'}.` };
  }
  
  // Rate limits
  if (pageText.includes('Rate limit exceeded') || pageText.includes('Too many requests') || pageText.includes('try again later')) {
    return { status: 'error', type: 'ratelimit', message: `Rate limit hit on ${isGrok ? 'Grok' : 'ChatGPT'}. Please try again later.` };
  }
  
  return null;
}

// State trackers for stream stability across polling checks
let streamStabilityTracker = {
  lastLength: 0,
  lastChangeTime: Date.now(),
  stableCycles: 0,
  promptStartTime: 0
};

let gptIntroStabilityTracker = {
  lastLength: 0,
  lastChangeTime: Date.now(),
  stableCycles: 0,
  promptStartTime: 0
};

// Synchronously check if standard generation is complete
function isGenerationDone() {
  const block = checkBlockStatus();
  if (block) return { error: block.message };

  const container = findLastAssistantResponse();
  if (!container) return { done: false };

  const currentText = container.innerText || '';
  const currentLen = currentText.trim().length;

  // Track text growth & changes
  if (Math.abs(currentLen - streamStabilityTracker.lastLength) > 10) {
    streamStabilityTracker.lastLength = currentLen;
    streamStabilityTracker.lastChangeTime = Date.now();
    streamStabilityTracker.stableCycles = 0;
  } else if (currentLen > 30) {
    streamStabilityTracker.stableCycles++;
  }

  // Initial buffer: Must have passed at least 6 seconds since prompt submission
  const elapsedSincePrompt = Date.now() - (streamStabilityTracker.promptStartTime || 0);
  if (streamStabilityTracker.promptStartTime > 0 && elapsedSincePrompt < 6000) {
    return { done: false };
  }

  // If stop button is visible, it is definitely still generating
  const stopBtn = findStopButton();
  if (stopBtn) {
    return { done: false };
  }

  // Look strictly for genuine Copy button
  const copyBtn = findCopyButton(container);

  // Text must be stable for at least 3 consecutive polling cycles (>= 6 seconds unchanged) and have meaningful content
  const isTextStable = streamStabilityTracker.stableCycles >= 3 && currentLen > 50;

  // Primary completion rule: A genuine Copy button is present AND text has stayed stable for at least 2 cycles (4s)
  if (copyBtn && streamStabilityTracker.stableCycles >= 2 && currentLen > 50) {
    return { done: true };
  }

  // Secondary fallback: Send button is active and text has been completely stable for at least 4 cycles (8s)
  const sendBtn = findSendButton();
  if (isTextStable && streamStabilityTracker.stableCycles >= 4 && sendBtn && !sendBtn.disabled) {
    return { done: true };
  }

  return { done: false };
}

// Synchronously check if Custom GPT intro is complete
function isGptIntroDone() {
  const block = checkBlockStatus();
  if (block) return { error: block.message };

  const editor = getWritingBlockContentContainer();
  const copyBtn = getWritingBlockCopyButton();

  // If Canvas (Writing block) is active
  if (editor && copyBtn) {
    const currentText = editor.innerText || '';
    const currentLen = currentText.trim().length;

    if (Math.abs(currentLen - gptIntroStabilityTracker.lastLength) > 5) {
      gptIntroStabilityTracker.lastLength = currentLen;
      gptIntroStabilityTracker.lastChangeTime = Date.now();
      gptIntroStabilityTracker.stableCycles = 0;
    } else if (currentLen > 30) {
      gptIntroStabilityTracker.stableCycles++;
    }

    const elapsed = Date.now() - (gptIntroStabilityTracker.promptStartTime || 0);
    if (gptIntroStabilityTracker.promptStartTime > 0 && elapsed < 4000) {
      return { done: false };
    }

    const stopBtn = findStopButton();
    const sendBtn = findSendButton();

    if (stopBtn) return { done: false };

    if (gptIntroStabilityTracker.stableCycles >= 2 && currentLen > 50) {
      return { done: true };
    }
    return { done: false };
  }

  // If fallback inline bubble is active
  const assistants = document.querySelectorAll('div[data-message-author-role="assistant"]');
  if (assistants.length > 0) {
    const lastAssistant = assistants[assistants.length - 1];
    const currentText = lastAssistant.innerText || '';
    const currentLen = currentText.trim().length;

    if (Math.abs(currentLen - gptIntroStabilityTracker.lastLength) > 5) {
      gptIntroStabilityTracker.lastLength = currentLen;
      gptIntroStabilityTracker.lastChangeTime = Date.now();
      gptIntroStabilityTracker.stableCycles = 0;
    } else if (currentLen > 30) {
      gptIntroStabilityTracker.stableCycles++;
    }

    const elapsed = Date.now() - (gptIntroStabilityTracker.promptStartTime || 0);
    if (gptIntroStabilityTracker.promptStartTime > 0 && elapsed < 4000) {
      return { done: false };
    }

    const stopBtn = findStopButton();
    const sendBtn = findSendButton();

    if (stopBtn) return { done: false };

    if (gptIntroStabilityTracker.stableCycles >= 2 && currentLen > 50) {
      return { done: true };
    }
  }

  return { done: false };
}

// Listen for execution commands from background worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[AutoAgent] Message received:', message.action);

  if (message.action === 'ping') {
    sendResponse({ status: 'pong' });
    return true;
  }

  if (message.action === 'enterPrompt') {
    streamStabilityTracker = {
      lastLength: 0,
      lastChangeTime: Date.now(),
      stableCycles: 0,
      promptStartTime: Date.now()
    };
    gptIntroStabilityTracker = {
      lastLength: 0,
      lastChangeTime: Date.now(),
      stableCycles: 0,
      promptStartTime: Date.now()
    };

    let inputEl = findInputBox();
    let retries = 0;

    const findInputInterval = setInterval(() => {
      inputEl = findInputBox();
      retries++;

      if (inputEl || retries > 10) {
        clearInterval(findInputInterval);

        if (!inputEl) {
          const auth = checkAuthStatus();
          if (!auth.loggedIn) {
            sendResponse({ status: 'error', message: auth.error });
          } else {
            sendResponse({ status: 'error', message: `Input box not found on ${isGrok ? 'Grok' : 'ChatGPT'}. Ensure you are logged in.` });
          }
          return;
        }

        const block = checkBlockStatus();
        if (block) {
          sendResponse(block);
          return;
        }

        try {
          inputEl.focus();
          setReactInputValue(inputEl, message.prompt);

          setTimeout(() => {
            const sendBtn = findSendButton();
            if (sendBtn && !sendBtn.disabled) {
              sendBtn.click();
              sendResponse({ status: 'success' });
            } else {
              const enterEvent = new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13
              });
              inputEl.dispatchEvent(enterEvent);
              sendResponse({ status: 'success', warning: 'Submitted via Enter key simulation' });
            }
          }, 500);

        } catch (err) {
          sendResponse({ status: 'error', message: `Input injection failed: ${err.toString()}` });
        }
      }
    }, 1000);

    return true;
  }

  if (message.action === 'waitForGeneration') {
    const block = checkBlockStatus();
    if (block) {
      sendResponse(block);
      return true;
    }

    let container = null;
    let retries = 0;

    const findInterval = setInterval(() => {
      retries++;
      const stopBtn = findStopButton();
      
      // Wait for the stop button to appear (meaning generation has started) or fallback after 4 seconds
      if (stopBtn || retries > 8) {
        container = findLastAssistantResponse();
        if (container) {
          clearInterval(findInterval);
          startObservingGrok();
        }
      }

      if (retries > 1200) { // 10 minutes (1200 * 500ms = 600s)
        clearInterval(findInterval);
        sendResponse({ status: 'error', message: `Response container or stop button did not appear on ${isGrok ? 'Grok' : 'ChatGPT'} after 10 minutes.` });
      }
    }, 500);

    function startObservingGrok() {
      console.log('[AutoAgent] Target container found. Starting MutationObserver and poller...');

      let debounceTimer;
      let isDone = false;
      let hasSeenStopButton = false;

      const checkCompletion = () => {
        if (isDone) return true;

        // 1. Primary indicator: if the copy button has appeared in the response container, generation is complete
        const copyBtn = container.querySelector('button[aria-label="Copy"]')
                     || container.querySelector('button[data-state]')
                     || Array.from(container.querySelectorAll('button')).find(b => {
                          const label = (b.getAttribute('aria-label') || '').toLowerCase();
                          return label.includes('copy');
                        });

        if (copyBtn) {
          console.log('[AutoAgent] Completion detected: Copy button is present in the response bubble.');
          isDone = true;
          clearInterval(pollTimer);
          observer.disconnect();
          sendResponse({ status: 'done' });
          return true;
        }

        const sendBtn = findSendButton();
        const stopBtn = findStopButton();

        if (stopBtn) {
          hasSeenStopButton = true;
        }

        console.log('[AutoAgent] checkCompletion - sendBtn:', !!sendBtn, 'stopBtn:', !!stopBtn, 'hasSeenStop:', hasSeenStopButton);

        // 2. Secondary rule: if we saw the stop button during generation and now it's gone, we are done
        if (hasSeenStopButton && !stopBtn) {
          console.log('[AutoAgent] Completion detected: stop button disappeared.');
          isDone = true;
          clearInterval(pollTimer);
          observer.disconnect();
          sendResponse({ status: 'done' });
          return true;
        }

        // 3. Fallback rule: if send/voice button is present and enabled, and stop button is absent
        if (!stopBtn && sendBtn && !sendBtn.disabled) {
          console.log('[AutoAgent] Completion detected: send/idle button active and stop button absent.');
          isDone = true;
          clearInterval(pollTimer);
          observer.disconnect();
          sendResponse({ status: 'done' });
          return true;
        }
        return false;
      };

      const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          checkCompletion();
        }, 1500);
      });

      observer.observe(container, { childList: true, subtree: true, characterData: true });

      // Parallel poller checks status every 1s in case DOM mutations are quiet
      const pollTimer = setInterval(() => {
        checkCompletion();
      }, 1000);

      // Run initial check after short delay
      setTimeout(() => {
        checkCompletion();
      }, 500);
    }

    return true;
  }

  if (message.action === 'extractContent') {
    const container = findLastAssistantResponse();
    if (container) {
      copyStandardAssistantContent(container)
        .then(markdown => {
          sendResponse({ 
            status: 'success', 
            content: '', 
            markdown: markdown 
          });
        })
        .catch(err => {
          console.error('[AutoAgent] Native copy extraction failed:', err.message);
          sendResponse({ 
            status: 'error', 
            message: `Native copy extraction failed: ${err.message}`,
            fatal: Boolean(err.stopAutomation)
          });
        });
    } else {
      sendResponse({ status: 'error', message: `Failed to locate response container on ${isGrok ? 'Grok' : 'ChatGPT'} during extraction.` });
    }
    return true;
  }

  if (message.action === 'waitForGptIntro') {
    getNewIntro()
      .then(res => {
        sendResponse({ status: 'success', content: res.content, markdown: res.markdown });
      })
      .catch(err => {
        sendResponse({ status: 'error', message: err.message || err.toString(), fatal: Boolean(err.stopAutomation) });
      });
    return true;
  }
  if (message.action === 'checkGenerationStatus') {
    const status = isGenerationDone();
    if (status.error) {
      sendResponse({ status: 'error', message: status.error });
    } else {
      sendResponse({ status: 'success', isDone: status.done });
    }
    return true;
  }

  if (message.action === 'checkGptIntroStatus') {
    const status = isGptIntroDone();
    if (status.error) {
      sendResponse({ status: 'error', message: status.error });
    } else {
      sendResponse({ status: 'success', isDone: status.done });
    }
    return true;
  }
});
