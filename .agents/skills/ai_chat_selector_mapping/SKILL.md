---
name: AI Chat Selector Mapping
description: How to inspect, verify, and write robust DOM selectors (inputs, send/stop/copy buttons) for AI chat clients like ChatGPT and Grok.
---

# AI Chat Selector Mapping Skill

This skill outlines the best practices for mapping selectors in modern Single-Page Application (SPA) chat interfaces (like ChatGPT and Grok) to prevent automation scripts from hanging due to dynamic layout states.

---

## 1. Dynamic Button Swapping Pattern

AI chat composers dynamically swap submit buttons based on the text state:
- **Idle State**: When the input field is empty, the send button is hidden or replaced by a voice button (e.g., `aria-label="Start Voice"` or `aria-label="Enter voice mode"`).
- **Send State**: When text is typed, the button changes to a submit/send action (e.g., `data-testid="send-button"` or `data-testid="chat-submit"`).
- **Generating/Stop State**: While the model is writing, the button is replaced by a stop action (e.g., `data-testid="stop-button"` or `aria-label="Stop model response"`).

> [!WARNING]
> Because the send button disappears from the DOM when the input field is empty, checking `if (sendBtn && !sendBtn.disabled)` will fail once generation finishes (since `sendBtn` is `null`). You must include the voice button as a fallback inside your `findSendButton` function!

---

## 2. Recommended Selector Mappings

### Grok Selectors
- **Input Textbox**: `div[contenteditable="true"][aria-label*="Grok"]` (TipTap ProseMirror container)
- **Send Button**: `button[data-testid="chat-submit"]` or `button[aria-label="Submit"]`
- **Stop Button**: `button[aria-label="Stop model response"]`
- **Voice Fallback**: `button[aria-label*="voice"]` or `button[aria-label*="Voice"]`

### ChatGPT Selectors
- **Input Textbox**: `textarea#prompt-textarea` or `div[contenteditable="true"]`
- **Send Button**: `#composer-submit-button` or `button[data-testid="send-button"]`
- **Stop Button**: `button[data-testid="stop-button"]` or `button[aria-label="Stop answering"]`
- **Voice Fallback**: `button[aria-label*="voice" i]` (Start Voice button)

---

## 3. Robust JavaScript Completion Checker

Always use a dual-safe check loop (polling every 500ms to 1s) to detect completion. Do not rely solely on `MutationObserver` debounces, as continuous animations (like blinking cursors) can keep resetting the debounce timer indefinitely.

```javascript
let isDone = false;
let hasSeenStopButton = false;

const checkCompletion = () => {
  if (isDone) return true;
  const sendBtn = findSendButton();
  const stopBtn = findStopButton();

  if (stopBtn) {
    hasSeenStopButton = true;
  }

  // Rule 1: If we saw the stop button during generation and now it's gone, we are done
  if (hasSeenStopButton && !stopBtn) {
    isDone = true;
    resolveCompletion();
    return true;
  }

  // Rule 2: If the stop button is absent and the send/voice button is present and enabled
  if (!stopBtn && sendBtn && !sendBtn.disabled) {
    isDone = true;
    resolveCompletion();
    return true;
  }
  return false;
};
```
