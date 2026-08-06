// Grok & ChatGPT Automation Content Script
console.log('[AutoAgent] Content script injected on host:', window.location.hostname);

const isGrok = window.location.hostname.includes('grok.com');

// Heartbeat keepalive with the service worker
const heartbeatInterval = setInterval(() => {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'heartbeat' }, () => {
      if (chrome.runtime.lastError) {
        // Suppress connection logs when background worker is asleep/reloading
      }
    });
  } else {
    clearInterval(heartbeatInterval);
  }
}, 5000);

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
    return document.querySelector('button[aria-label="Stop model response"]');
  } else {
    // ChatGPT Selectors
    const stopBtn = document.querySelector('button[data-testid="stop-button"]')
                 || document.querySelector('button[aria-label="Stop answering"]')
                 || document.querySelector('button[aria-label*="stop" i]')
                 || document.querySelector('button[aria-label*="Stop" i]')
                 || document.querySelector('button[aria-label="Stop generating"]')
                 || document.querySelector('button[aria-label="Stop"]')
                 || document.querySelector('#composer-submit-button')
                 || document.querySelector('button[data-testid="send-button"]');

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

// Locate the last assistant response container (for standard chats)
function findLastAssistantResponse() {
  if (isGrok) {
    const selectors = [
      '.markdown',
      '.message-content',
      '[data-testid="message-content"]',
      '[class*="message-text"]',
      '[class*="message-body"]'
    ];
    for (const selector of selectors) {
      const blocks = document.querySelectorAll(selector);
      if (blocks.length > 0) return blocks[blocks.length - 1];
    }
    const genericBlocks = document.querySelectorAll('[class*="message"], [class*="bubble"]');
    if (genericBlocks.length > 0) return genericBlocks[genericBlocks.length - 1];
    return null;
  } else {
    // ChatGPT: Standard inline bubble check
    const assistants = document.querySelectorAll('div[data-message-author-role="assistant"]');
    if (assistants.length > 0) {
      const lastAssistant = assistants[assistants.length - 1];
      return lastAssistant.querySelector('.markdown') 
          || lastAssistant.querySelector('.prose') 
          || lastAssistant;
    }
    const markdownBlocks = document.querySelectorAll('.markdown.prose, .prose');
    if (markdownBlocks.length > 0) return markdownBlocks[markdownBlocks.length - 1];
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
  
  return header.querySelector('button[aria-label="Copy"][data-state]')
      || header.querySelector('button[aria-label="Copy"]')
      || header.querySelector('button[aria-label*="Copy" i]')
      || header.querySelector('button[data-testid*="copy"]');
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

// Extracts plain text from inline message bubbles by clicking the message copy button
async function copyStandardAssistantContent(assistantNode) {
  const btn = assistantNode.querySelector('button[aria-label="Copy"][data-state]')
           || assistantNode.querySelector('button[aria-label="Copy"]')
           || assistantNode.querySelector('button[data-testid="copy-button"]')
           || Array.from(assistantNode.querySelectorAll('button')).find(b => {
                const label = (b.getAttribute('aria-label') || '').toLowerCase();
                return label.includes('copy');
              });

  if (!btn) {
    console.log('[AutoAgent] Standard copy button not found inside chat bubble. Falling back to innerText.');
    return assistantNode.innerText.trim();
  }

  try {
    console.log('[AutoAgent] Clicking standard copy button...');
    btn.click();

    // Clipboard write delay
    await new Promise(r => setTimeout(r, 300));

    const text = await navigator.clipboard.readText();
    if (text && text.trim().length >= 20) {
      return text.trim();
    }
    throw new Error('Clipboard content empty or too short');
  } catch (err) {
    console.warn('[AutoAgent] Standard copy button clipboard read failed, using innerText:', err.message);
    const fallbackText = assistantNode.innerText.trim();
    if (fallbackText.length < 20) {
      throw new Error('Both standard clipboard copy and innerText fallback returned empty content');
    }
    return fallbackText;
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

// Simulated copy click and clipboard extraction with innerText fallback
async function copyWritingBlockContent(header, editor) {
  const btn = getWritingBlockCopyButton();
           
  if (!btn) {
    console.log('[AutoAgent] Canvas copy button not found inside header. Falling back to innerText.');
    return editor.innerText.trim();
  }

  try {
    console.log('[AutoAgent] Clicking Canvas copy button...');
    btn.click();

    // Clipboard write delay
    await new Promise(r => setTimeout(r, 300));

    const text = await navigator.clipboard.readText();
    if (text && text.trim().length >= 20) {
      return text.trim();
    }
    throw new Error('Clipboard content empty or too short');
  } catch (err) {
    console.warn('[AutoAgent] Clipboard extraction failed, falling back to innerText:', err.message);
    const fallbackText = editor.innerText.trim();
    if (fallbackText.length < 20) {
      throw new Error('Both clipboard and innerText fallback returned empty content');
    }
    return fallbackText;
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

// Synchronously check if standard generation is complete
function isGenerationDone() {
  const block = checkBlockStatus();
  if (block) return { error: block.message };

  const container = findLastAssistantResponse();
  if (!container) return { done: false };

  // 1. Check if copy button is present
  const copyBtn = container.querySelector('button[aria-label="Copy"]')
               || container.querySelector('button[data-state]')
               || Array.from(container.querySelectorAll('button')).find(b => {
                    const label = (b.getAttribute('aria-label') || '').toLowerCase();
                    return label.includes('copy');
                  });

  if (copyBtn) {
    return { done: true };
  }

  // 2. Check if stop button is absent and send button is active
  const sendBtn = findSendButton();
  const stopBtn = findStopButton();

  if (!stopBtn && sendBtn && !sendBtn.disabled) {
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
    const sendBtn = findSendButton();
    const stopBtn = findStopButton();
    if (sendBtn && !sendBtn.disabled && !stopBtn) {
      return { done: true };
    }
    return { done: false };
  }

  // If fallback inline bubble is active
  const assistants = document.querySelectorAll('div[data-message-author-role="assistant"]');
  if (assistants.length > 0) {
    const lastAssistant = assistants[assistants.length - 1];
    const sendBtn = findSendButton();
    const stopBtn = findStopButton();
    if (sendBtn && !sendBtn.disabled && !stopBtn) {
      return { done: true };
    }
  }

  return { done: false };
}

// Simple HTML-to-Markdown converter helper (used as robust fallback)
function htmlToMarkdown(html) {
  if (!html) return '';
  let md = html;

  // Replace line breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');

  // Headers (H1 to H6)
  md = md.replace(/<h1>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4>([\s\S]*?)<\/h4>/gi, '#### $1\n\n');
  md = md.replace(/<h5>([\s\S]*?)<\/h5>/gi, '##### $1\n\n');
  md = md.replace(/<h6>([\s\S]*?)<\/h6>/gi, '###### $1\n\n');

  // Bold & Italic
  md = md.replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*');

  // Code blocks (pre/code)
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```\n\n');
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Lists
  md = md.replace(/<li>([\s\S]*?)<\/li>/gi, (match, p1) => {
    return `- ${p1.trim()}\n`;
  });
  md = md.replace(/<ul>([\s\S]*?)<\/ul>/gi, '$1\n');
  md = md.replace(/<ol>([\s\S]*?)<\/ol>/gi, '$1\n');

  // Paragraphs
  md = md.replace(/<p>([\s\S]*?)<\/p>/gi, '$1\n\n');

  // Blockquotes
  md = md.replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, '> $1\n\n');

  // Remove any remaining HTML tags
  md = md.replace(/<[^>]+>/g, '');

  // Decode standard HTML entities using browser context
  const textarea = document.createElement('textarea');
  textarea.innerHTML = md;
  md = textarea.value;

  // Clean up excess newlines
  md = md.replace(/\n{3,}/g, '\n\n');

  return md.trim();
}

// Listen for execution commands from background worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[AutoAgent] Message received:', message.action);

  if (message.action === 'ping') {
    sendResponse({ status: 'pong' });
    return true;
  }

  if (message.action === 'enterPrompt') {
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
            content: container.innerHTML, 
            markdown: markdown 
          });
        })
        .catch(err => {
          // Fallback to innerText if clipboard read fails
          console.warn('[AutoAgent] Clipboard copy failed during extraction, using innerText:', err.message);
          sendResponse({ 
            status: 'success', 
            content: container.innerHTML, 
            markdown: container.innerText || '' 
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
        sendResponse({ status: 'error', message: err.message || err.toString() });
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
