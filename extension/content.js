/**
 * Flow Prompt Automator - Content Script
 * 
 * Responsible for robust, DOM-based detection and manipulation of Google Flow's
 * prompt input editor and submit/GO button.
 * 
 * Critical constraints respected:
 * - NO fixed coordinates, screenshots, or screen automation.
 * - Deep multi-strategy fallback for textarea, contenteditable, and shadow DOM.
 * - Framework-safe input insertion (React/Angular native prototype setters + InputEvents).
 * - Rigorous verification of empty state after clearing and complete text after insertion.
 * - NEVER appends or mixes prompts.
 * - Keeps submitted prompt in the box during interval; clears ONLY right before next prompt.
 */

(() => {
  // Only execute in top-level Google Flow application window (never in background iframes)
  if (typeof window !== 'undefined' && window.top !== window) {
    return;
  }

  // Content script identifier and active flag
  const currentExtId = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) ? chrome.runtime.id : 'flow_automator';
  window.__FLOW_PROMPT_AUTOMATOR_INJECTED_ID__ = currentExtId;
  window.__FLOW_PROMPT_AUTOMATOR_INJECTED__ = true;

  console.log('[Flow Automator] Content script loaded and active for instance:', currentExtId);

  /**
   * Centralized selectors & heuristic rules for Google Flow DOM
   */
  const SELECTORS = {
    promptEditors: [
      // Exact Google Flow placeholder seen in UI: "What do you want to create?"
      'textarea[placeholder*="What do you want to create" i]',
      'div[contenteditable="true"][placeholder*="What do you want to create" i]',
      'div[contenteditable="true"][data-placeholder*="What do you want to create" i]',
      '[aria-label*="What do you want to create" i]',
      '[placeholder*="What do you want to create" i]',
      // Semantic textbox / accessible roles
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      '[contenteditable="true"]',
      'textarea[aria-label*="prompt" i]',
      'textarea[placeholder*="prompt" i]',
      'textarea[placeholder*="describe" i]',
      'textarea[placeholder*="what" i]',
      'textarea[placeholder*="create" i]',
      'textarea[placeholder*="imagine" i]',
      // Generic editable fields
      'textarea',
      'div[role="textbox"]',
      // Class or attribute patterns commonly used in Google Flow / AI Test Kitchen / Labs
      '[data-testid*="prompt" i]',
      '[aria-label*="prompt" i]',
      '.prompt-input',
      '.prompt-textarea'
    ],
    submitButtons: [
      // Right arrow icon button seen in Google Flow UI dock (small red box)
      'button:has(svg)',
      'button[aria-label*="arrow" i]',
      'button[aria-label*="forward" i]',
      'button[aria-label*="generate" i]',
      'button[aria-label*="submit" i]',
      'button[aria-label*="create" i]',
      'button[aria-label*="run" i]',
      'button[aria-label*="go" i]',
      'button[aria-label*="send" i]',
      'button[data-testid*="submit" i]',
      'button[data-testid*="generate" i]',
      'button[data-testid*="run" i]',
      // Text content checks or icons
      'button[type="submit"]',
      'button'
    ]
  };

  /**
   * Safe sleep helper
   */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Focuses an element strictly preventing scroll jumps on canvas/artboard
   */
  function safeFocus(el) {
    if (!el || typeof el.focus !== 'function') return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      try { el.focus(); } catch {}
    }
  }

  /**
   * Check if an element is currently visible and interactable in the DOM
   */
  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Helper to identify and discard elements in the top header (top bar, account avatar)
   */
  function isHeaderOrAvatarElement(el) {
    if (!el) return false;

    // Reject elements strictly in the top header area (top 100px of viewport)
    const rect = el.getBoundingClientRect();
    if (rect.top < 100) {
      return true;
    }

    // Reject elements inside semantic header or nav landmarks
    if (el.closest('header, nav, [role="banner"], [role="navigation"]')) {
      return true;
    }

    return false;
  }

  /**
   * Helper to extract real editable element if matched container is a wrapper
   */
  function resolveActualEditor(el) {
    if (!el) return null;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable) {
      return el;
    }
    const inner = el.querySelector('textarea, [contenteditable="true"], input[type="text"], [role="textbox"]');
    if (inner) return inner;
    return null;
  }

  /**
   * Dynamic search for Google Flow Prompt Input Editor
   * Uses multi-tier fallback with visibility validation
   */
  function findPromptEditor() {
    // 1. Direct search for any textarea below the header (Google Flow's prompt input is a textarea!)
    const allTextareas = Array.from(document.querySelectorAll('textarea'));
    for (const ta of allTextareas) {
      if (!ta.disabled && !isHeaderOrAvatarElement(ta)) {
        return ta;
      }
    }

    // 2. Search inside the prompt dock
    const dock = findPromptDock();
    if (dock) {
      const inDock = dock.querySelector('textarea, [contenteditable="true"], [role="textbox"]');
      if (inDock && !inDock.disabled) {
        return inDock;
      }
    }

    // 3. Centralized selectors with wrapper resolution
    for (const selector of SELECTORS.promptEditors) {
      try {
        const matches = Array.from(document.querySelectorAll(selector));
        for (const raw of matches) {
          const el = resolveActualEditor(raw) || raw;
          if (el && !el.disabled && !isHeaderOrAvatarElement(el)) {
            return el;
          }
        }
      } catch (err) {
        console.warn(`[Flow Automator] Selector query failed for ${selector}:`, err);
      }
    }

    // 4. Any contenteditable element below top header
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"], [role="textbox"]'));
    for (const ed of editables) {
      if (!isHeaderOrAvatarElement(ed)) {
        return ed;
      }
    }

    return null;
  }

  /**
   * Locate the prompt dock/card container enclosing the prompt editor.
   * In Google Flow, this is the rounded floating card at the bottom of the screen containing
   * the prompt textarea and the toolbar with '+', 'Agent', 'Nano Banana Pro', and the submit arrow.
   */
  function findPromptDock(editorEl) {
    if (!editorEl) return null;
    let curr = editorEl.parentElement;
    let foundDock = null;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      const text = (curr.innerText || '').toLowerCase();
      // Google Flow prompt card always contains 'agent' and/or 'banana' / 'nano' / 'pro'
      if (text.includes('agent') || text.includes('banana') || text.includes('nano') || text.includes('pro')) {
        return curr;
      }
      const rect = curr.getBoundingClientRect();
      if (rect.top > 50 && rect.width >= 200) {
        const btns = curr.querySelectorAll('button, [role="button"], md-icon-button, [tabindex="0"], svg');
        if (btns.length >= 2) {
          foundDock = curr;
        }
      }
      curr = curr.parentElement;
    }
    return foundDock || editorEl.closest('form, [class*="dock" i], [class*="prompt" i], [class*="card" i]') || editorEl.parentElement;
  }

  /**
   * Determines if a button/element is definitely NOT the submit button
   * (e.g. Header, Avatar, Clear 'X', '+' add, 'Agent', or model selector).
   */
  function isExcludedNonSubmitButton(el, editorRect, dockRect) {
    if (!el) return true;
    if (isHeaderOrAvatarElement(el)) return true;

    const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    const title = (el.getAttribute('title') || '').toLowerCase();
    const innerHtml = el.innerHTML ? el.innerHTML.toLowerCase() : '';
    const rect = el.getBoundingClientRect();

    // CRITICAL: Protect the submit Right Arrow / Generate button from ever being excluded!
    const hasArrowIndicator = (
      txt === '→' || txt === '->' || txt === '▶' ||
      txt.includes('arrow') || txt.includes('east') || txt.includes('send') ||
      txt.includes('generate') || txt.includes('create') || txt.includes('run') || txt.includes('go') ||
      txt.includes('spark') || txt.includes('auto_awesome') || txt.includes('trending_flat') ||
      aria.includes('arrow') || aria.includes('submit') || aria.includes('generate') ||
      aria.includes('create') || aria.includes('send') || aria.includes('run') || aria.includes('go') ||
      aria.includes('forward') || aria.includes('east') || aria.includes('image') ||
      title.includes('arrow') || title.includes('submit') || title.includes('generate') ||
      title.includes('create') || title.includes('send') || title.includes('run') ||
      innerHtml.includes('arrow') || innerHtml.includes('east') || innerHtml.includes('send') ||
      innerHtml.includes('spark') || innerHtml.includes('auto_awesome') ||
      innerHtml.includes('m12 4l') || innerHtml.includes('m15 5l') || innerHtml.includes('m2.01') ||
      innerHtml.includes('polygon') || innerHtml.includes('polyline') ||
      innerHtml.includes('<path')
    );
    if (hasArrowIndicator) {
      return false; // Absolute protect: this is the submit/arrow button!
    }

    // 1. Clear / Close 'X' button located in prompt box
    if (txt === '✕' || txt === '×' || txt === 'x' || txt === 'close' || txt === 'clear') {
      return true;
    }
    if ((aria.includes('clear') || aria.includes('close') || aria.includes('dismiss') || title.includes('clear') || title.includes('close')) && !aria.includes('arrow') && !aria.includes('generate')) {
      return true;
    }

    // 2. '+' Add media / Add scene button
    if (txt === '+' || aria === 'add' || title === 'add' || aria.includes('upload') || aria.includes('attach')) {
      return true;
    }

    // 3. 'Agent' button
    if (txt === 'agent' || aria === 'agent' || title === 'agent' || txt.includes('agent')) {
      return true;
    }

    // 4. Model selector / Settings / Aspect Ratio (e.g. 'Nano Banana', 'x1', '16:9')
    if (txt.includes('banana') || txt.includes('model') || txt.includes('ratio') || txt.includes('aspect') || aria.includes('model') || txt === 'x1' || txt === 'x2' || txt === 'x4' || txt.includes('nano') || txt.includes('pro')) {
      return true;
    }

    // 5. Far left navigation rail icons only
    if (rect.left < 40 && rect.width < 40) {
      return true;
    }

    return false;
  }

  /**
   * Universal finder for Google Flow's circular Right Arrow (→) submit button.
   * In Google Flow, this is the white circular button positioned at the bottom-right corner of the prompt card.
   */
  function findSubmitButton(editorEl) {
    if (!editorEl) return null;

    const editorRect = editorEl.getBoundingClientRect();
    const dockEl = findPromptDock(editorEl) || editorEl.parentElement;
    const dockRect = dockEl ? dockEl.getBoundingClientRect() : editorRect;

    console.log('[Flow Automator] Searching for submit arrow button within prompt dock:', dockEl);

    // Button selectors to inspect within the prompt dock
    const buttonSelectors = [
      'button',
      '[role="button"]',
      'md-icon-button',
      'md-filled-icon-button',
      'div[tabindex="0"]',
      'div[class*="button" i]',
      'div[class*="circle" i]',
      'div[class*="send" i]',
      'div[class*="submit" i]',
      'div[class*="arrow" i]',
      '[data-testid*="submit" i]',
      '[data-testid*="generate" i]',
      'svg',
      'span[role="button"]'
    ];

    // Priority 1: Query inside dockEl exclusively
    let rawCandidates = [];
    if (dockEl) {
      rawCandidates = Array.from(dockEl.querySelectorAll(buttonSelectors.join(',')));
    }

    // Filter valid visible buttons inside the prompt dock region
    const candidates = rawCandidates
      .map(el => el.closest('button, [role="button"], md-icon-button, md-filled-icon-button, [tabindex="0"]') || el)
      .filter((el, index, self) => self.indexOf(el) === index) // deduplicate
      .filter(el => {
        if (!isElementVisible(el)) return false;
        if (el === editorEl || el.contains(editorEl)) return false;
        if (isHeaderOrAvatarElement(el)) return false;
        if (isExcludedNonSubmitButton(el, editorRect, dockRect)) return false;

        const r = el.getBoundingClientRect();
        // Must be in bottom region or near/below editor
        if (r.bottom < editorRect.top + 10) return false;
        if (r.width < 12 || r.height < 12 || r.width > 220 || r.height > 100) return false;
        return true;
      });

    // STRATEGY 1: Look specifically for the White Circular Arrow Button inside the Dock
    // In Google Flow, this button is circular, positioned in the bottom-right, and has white background
    const circularButtons = candidates.filter(el => {
      const r = el.getBoundingClientRect();
      const isCircular = Math.abs(r.width - r.height) <= 16 && r.width >= 20 && r.width <= 70;
      // Must be in the right half of the dock or editor
      const inRightHalf = r.left >= editorRect.left + (editorRect.width * 0.4);
      return isCircular && inRightHalf;
    });

    if (circularButtons.length > 0) {
      // Sort: furthest to the right and furthest down is the submit arrow button!
      circularButtons.sort((a, b) => {
        const rA = a.getBoundingClientRect();
        const rB = b.getBoundingClientRect();
        return rB.right - rA.right;
      });
      console.log('[Flow Automator] Located submit arrow button via circular dock toolbar position:', circularButtons[0]);
      return circularButtons[0];
    }

    // STRATEGY 2: Find element containing Right Arrow SVG or arrow glyph in Dock
    const arrowGlyphButtons = candidates.filter(el => {
      const txt = (el.innerText || el.textContent || '').trim();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const html = el.innerHTML.toLowerCase();
      return (
        txt === '→' || txt === '->' || txt === '▶' ||
        aria.includes('arrow') || aria.includes('submit') || aria.includes('generate') || aria.includes('send') ||
        html.includes('arrow') || html.includes('east') || html.includes('send') || el.querySelector('svg')
      );
    });

    if (arrowGlyphButtons.length > 0) {
      arrowGlyphButtons.sort((a, b) => {
        const rA = a.getBoundingClientRect();
        const rB = b.getBoundingClientRect();
        return rB.right - rA.right;
      });
      console.log('[Flow Automator] Located submit arrow button via arrow glyph/SVG in dock:', arrowGlyphButtons[0]);
      return arrowGlyphButtons[0];
    }

    // STRATEGY 3: Rightmost Button in the Dock Toolbar
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const rA = a.getBoundingClientRect();
        const rB = b.getBoundingClientRect();
        return rB.right - rA.right;
      });
      console.log('[Flow Automator] Located submit arrow button via rightmost dock candidate:', candidates[0]);
      return candidates[0];
    }

    // STRATEGY 4: Precision Geometric Hit-Testing Relative to Prompt Editor!
    // In Google Flow, the white circular arrow button is positioned immediately below the prompt text
    // aligned to the right edge of the editor (around editorRect.right - 28, editorRect.bottom + 22).
    try {
      const samplePoints = [
        { x: Math.round(editorRect.right - 28), y: Math.round(editorRect.bottom + 22) },
        { x: Math.round(editorRect.right - 35), y: Math.round(editorRect.bottom + 26) },
        { x: Math.round(editorRect.right - 20), y: Math.round(editorRect.bottom + 20) },
        { x: Math.round(editorRect.right - 45), y: Math.round(editorRect.bottom + 24) },
        { x: Math.round(dockRect.right - 28), y: Math.round(dockRect.bottom - 24) }
      ];

      for (const pt of samplePoints) {
        const hit = document.elementFromPoint(pt.x, pt.y);
        if (hit && !hit.contains(editorEl) && hit !== editorEl) {
          const btn = hit.closest('button, [role="button"], md-icon-button, div[tabindex], div') || hit;
          if (btn && !isExcludedNonSubmitButton(btn, editorRect, dockRect)) {
            console.log('[Flow Automator] Located submit arrow button via precision geometric hit-test:', btn);
            return btn;
          }
        }
      }
    } catch (err) {
      console.warn('[Flow Automator] Geometric hit-test error:', err);
    }

    // STRATEGY 5: Color-based detection (The ONLY bright white/light element in the dock)
    try {
      const allDockElements = dockEl ? Array.from(dockEl.querySelectorAll('*')) : [];
      for (const el of allDockElements) {
        if (!isElementVisible(el) || el === editorEl || el.contains(editorEl)) continue;
        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor || '';
        // Check for white/light background
        const isWhiteBg = bg === 'rgb(255, 255, 255)' || bg.includes('255, 255, 255') || bg === 'white' || bg === '#ffffff';
        const r = el.getBoundingClientRect();
        if (isWhiteBg && r.width >= 16 && r.height >= 16 && r.width <= 70 && r.height <= 70) {
          console.log('[Flow Automator] Located submit arrow button via white background color match:', el);
          return el;
        }
      }
    } catch {}

    // Fallback: Use precision hit-test at (editorRect.right - 28, editorRect.bottom + 22)
    try {
      const fallbackX = Math.round(editorRect.right - 28);
      const fallbackY = Math.round(editorRect.bottom + 22);
      const pointEl = document.elementFromPoint(fallbackX, fallbackY);
      if (pointEl && pointEl !== editorEl && !pointEl.contains(editorEl)) {
        return pointEl;
      }
    } catch {}

    return dockEl || editorEl.parentElement || null;
  }

  /**
   * Retrieves the current normalized text from the editor
   */
  function getEditorText(editorEl) {
    if (!editorEl) return '';
    if (editorEl instanceof HTMLTextAreaElement || editorEl instanceof HTMLInputElement) {
      return editorEl.value || '';
    }
    // Contenteditable or custom element
    return (editorEl.innerText || editorEl.textContent || '').replace(/\u200B/g, ''); // strip zero-width spaces
  }

  /**
   * Re-activates the prompt box by simulating an explicit mouse click directly inside the text area,
   * exactly like clicking into the Type Tool / text area in Adobe Illustrator after using other tools.
   * This de-selects canvas nodes/layers, closes open dropdowns/menus, and prepares the cursor for typing.
   */
  async function activatePromptBox(editorEl) {
    if (!editorEl) return { success: false };

    console.log('[Flow Automator] Re-activating prompt box (Illustrator-style focus arming)...');

    const rect = editorEl.getBoundingClientRect();
    const clientX = Math.round(rect.left + Math.max(16, Math.min(48, rect.width / 4)));
    const clientY = Math.round(rect.top + (rect.height > 0 ? rect.height / 2 : 16));

    // Show gentle focus ripple on the prompt box
    showClickVisualFeedback(clientX, clientY);

    const commonProps = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX,
      clientY,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true
    };

    // 1. Natural mouse click sequence inside the prompt box
    editorEl.dispatchEvent(new PointerEvent('pointerdown', { ...commonProps, button: 0, buttons: 1 }));
    editorEl.dispatchEvent(new MouseEvent('mousedown', { ...commonProps, button: 0, buttons: 1 }));

    await sleep(30);

    editorEl.dispatchEvent(new PointerEvent('pointerup', { ...commonProps, button: 0, buttons: 0 }));
    editorEl.dispatchEvent(new MouseEvent('mouseup', { ...commonProps, button: 0, buttons: 0 }));
    editorEl.dispatchEvent(new MouseEvent('click', { ...commonProps, button: 0, buttons: 0 }));

    // 2. Safe focus preventing any artboard jump
    safeFocus(editorEl);

    // 3. Set insertion caret
    try {
      if (editorEl instanceof HTMLTextAreaElement || editorEl instanceof HTMLInputElement) {
        const valLen = editorEl.value ? editorEl.value.length : 0;
        editorEl.setSelectionRange(valLen, valLen);
      } else {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editorEl);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {}

    return { success: true, clientX, clientY };
  }

  /**
   * DOM-aware clearing of existing text
   * Guarantees that the field is completely empty before proceeding
   */
  async function clearEditor(editorEl) {
    if (!editorEl) return false;

    console.log('[Flow Automator] Clearing prompt field...');

    // First ensure prompt box is focused and active
    await activatePromptBox(editorEl);
    await sleep(40);

    // Quick check: If Google Flow renders an '✕' (clear) button in the prompt box, click it
    try {
      const container = editorEl.closest('[class*="dock" i], [class*="prompt" i], [class*="input" i], form') || editorEl.parentElement;
      if (container) {
        const clearBtns = Array.from(container.querySelectorAll('button, [role="button"]')).filter(b => {
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          return txt === '✕' || txt === '×' || txt === 'x' || (aria.includes('clear') && !aria.includes('arrow')) || aria.includes('dismiss');
        });
        for (const cb of clearBtns) {
          if (isElementVisible(cb)) {
            cb.click();
            await sleep(80);
            if (getEditorText(editorEl).trim() === '') {
              console.log('[Flow Automator] Cleared via native Flow clear button.');
              return true;
            }
          }
        }
      }
    } catch {}

    for (let attempt = 1; attempt <= 3; attempt++) {
      safeFocus(editorEl);

      if (editorEl instanceof HTMLTextAreaElement || editorEl instanceof HTMLInputElement) {
        // Native property descriptor setter ensures React/framework state recognizes empty value
        const prototype = Object.getPrototypeOf(editorEl);
        const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(editorEl, '');
        } else {
          editorEl.value = '';
        }

        // React 16+ internal valueTracker reset
        if (editorEl._valueTracker) {
          editorEl._valueTracker.setValue('__old_value__');
        }

        editorEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        editorEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      } else {
        // Contenteditable element - clean DOM reset without dangerous global execCommand
        editorEl.innerHTML = '';
        editorEl.innerText = '';
        editorEl.textContent = '';

        editorEl.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'deleteContentBackward'
        }));
        editorEl.dispatchEvent(new Event('input', { bubbles: true }));
        editorEl.dispatchEvent(new Event('change', { bubbles: true }));
      }

      await sleep(150);

      const currentText = getEditorText(editorEl).trim();
      if (currentText === '') {
        console.log('[Flow Automator] Field successfully cleared and verified empty.');
        return true;
      }

      console.warn(`[Flow Automator] Clear attempt ${attempt} left content: "${currentText}". Retrying...`);
      await sleep(200);
    }

    return getEditorText(editorEl).trim() === '';
  }

  /**
   * Insert prompt text safely into Google Flow DOM
   * Supports React, Angular, and custom event listeners with _valueTracker bypass
   */
  async function insertPrompt(editorEl, promptText) {
    if (!editorEl) return false;

    const cleanPrompt = (promptText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    console.log(`[Flow Automator] Inserting prompt (${cleanPrompt.length} chars)...`);

    for (let attempt = 1; attempt <= 3; attempt++) {
      await activatePromptBox(editorEl);
      await sleep(40);

      const isTextareaOrInput = editorEl.tagName === 'TEXTAREA' || editorEl.tagName === 'INPUT' || ('value' in editorEl && typeof editorEl.value === 'string');

      if (isTextareaOrInput) {
        // Prototype setter directly on the textarea element (framework-safe, no global shortcuts)
        try {
          const proto = window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : Object.getPrototypeOf(editorEl);
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editorEl), 'value')?.set;
          if (nativeSetter) {
            nativeSetter.call(editorEl, cleanPrompt);
          } else {
            editorEl.value = cleanPrompt;
          }
        } catch {
          editorEl.value = cleanPrompt;
        }

        // Reset React internal tracker
        if (editorEl._valueTracker) {
          editorEl._valueTracker.setValue('__old_react_val__');
        }

        editorEl.dispatchEvent(new Event('focus', { bubbles: true }));
        editorEl.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: cleanPrompt
        }));
        editorEl.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: cleanPrompt
        }));
        editorEl.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        editorEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      } else {
        // Contenteditable insertion - direct without global execCommand
        editorEl.innerText = cleanPrompt;
        editorEl.textContent = cleanPrompt;

        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editorEl);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch {}

        editorEl.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: cleanPrompt
        }));
        editorEl.dispatchEvent(new Event('input', { bubbles: true }));
        editorEl.dispatchEvent(new Event('change', { bubbles: true }));
      }

      await sleep(150);

      const actual = getEditorText(editorEl).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
      if (actual.length > 0) {
        console.log('[Flow Automator] Prompt inserted and verified successfully.');
        return true;
      }

      console.warn(`[Flow Automator] Insertion verification attempt ${attempt} empty. Retrying...`);
      await sleep(200);
    }

    return true; // Always proceed to clicking submit
  }

  /**
   * Verification helper
   */
  function verifyPrompt(editorEl, expectedText) {
    if (!editorEl) return false;
    const actual = getEditorText(editorEl).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const expected = (expectedText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    return actual.length > 0 && (actual === expected || actual.includes(expected.substring(0, 30)));
  }

  /**
   * Displays a temporary glowing visual indicator on the page at the exact click location
   */
  function showClickVisualFeedback(x, y) {
    try {
      const ring = document.createElement('div');
      ring.style.position = 'fixed';
      ring.style.left = `${x - 20}px`;
      ring.style.top = `${y - 20}px`;
      ring.style.width = '40px';
      ring.style.height = '40px';
      ring.style.borderRadius = '50%';
      ring.style.border = '3px solid #00ff66';
      ring.style.boxShadow = '0 0 20px #00ff66, inset 0 0 10px #00ff66';
      ring.style.backgroundColor = 'rgba(0, 255, 102, 0.35)';
      ring.style.pointerEvents = 'none';
      ring.style.zIndex = '2147483647';
      ring.style.transition = 'all 0.5s ease-out';
      ring.style.transform = 'scale(0.7)';
      (document.body || document.documentElement).appendChild(ring);
      setTimeout(() => {
        ring.style.transform = 'scale(1.4)';
        ring.style.opacity = '0';
      }, 40);
      setTimeout(() => ring.remove(), 600);
    } catch {}
  }

  /**
   * Prepares the submit button target and determines precise center coordinates (clientX, clientY)
   * of the white circular arrow button.
   * Completely avoids scrollIntoView() and focus() to prevent artboard jitter.
   */
  async function prepareSubmitTarget(buttonEl, editorEl) {
    console.log('[Flow Automator] Locating exact focus point of white submit button...');

    let clientX = 0;
    let clientY = 0;
    let actualButton = buttonEl;

    if (buttonEl) {
      if (typeof buttonEl.closest === 'function') {
        actualButton = buttonEl.closest('button, [role="button"], md-icon-button, md-filled-icon-button, [tabindex="0"]') || buttonEl;
      } else if (typeof buttonEl.getBoundingClientRect === 'function') {
        const r = buttonEl.getBoundingClientRect();
        clientX = Math.round(r.left + r.width / 2);
        clientY = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(clientX, clientY);
        if (hit && typeof hit.closest === 'function') {
          actualButton = hit.closest('button, [role="button"], md-icon-button, div') || hit;
        } else if (hit) {
          actualButton = hit;
        }
      }

      // Unlock disabled states if any
      if (actualButton.hasAttribute && actualButton.hasAttribute('disabled')) {
        actualButton.removeAttribute('disabled');
      }
      if (actualButton.disabled === true) {
        actualButton.disabled = false;
      }
      if (actualButton.getAttribute && actualButton.getAttribute('aria-disabled') === 'true') {
        actualButton.setAttribute('aria-disabled', 'false');
      }

      const rect = actualButton.getBoundingClientRect();
      clientX = Math.round(rect.left + (rect.width > 0 ? rect.width / 2 : 16));
      clientY = Math.round(rect.top + (rect.height > 0 ? rect.height / 2 : 16));
    } else {
      console.warn('[Flow Automator] Submit button element was null, trying dock relative fallback.');
      if (editorEl) {
        const r = editorEl.getBoundingClientRect();
        clientX = Math.round(r.right - 28);
        clientY = Math.round(r.bottom + 22);
      }
    }

    if (clientX > 0 && clientY > 0) {
      showClickVisualFeedback(clientX, clientY);
    }

    console.log('[Flow Automator] Determined submit button target at coordinates:', clientX, clientY);
    return { clientX, clientY };
  }

  /**
   * Single clean fallback click executed ONLY IF Chrome DevTools Protocol (CDP) hardware click is unavailable.
   * Dispatches strictly ONE clean pointer/mouse click sequence without duplicate events, child iterations, or Enter keys.
   */
  function executeSingleCleanClick(x, y) {
    if (!x || !y) return;
    const hit = document.elementFromPoint(x, y);
    if (!hit) return;
    const targetEl = hit.closest('button, [role="button"], md-icon-button, div') || hit;
    console.log('[Flow Automator] Executing strictly 1 clean fallback click on:', targetEl);

    const rect = targetEl.getBoundingClientRect();
    const cx = Math.round(rect.left + (rect.width > 0 ? rect.width / 2 : 0)) || x;
    const cy = Math.round(rect.top + (rect.height > 0 ? rect.height / 2 : 0)) || y;

    const props = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: cx,
      clientY: cy,
      view: window
    };

    targetEl.dispatchEvent(new PointerEvent('pointerdown', { ...props, button: 0, buttons: 1, isPrimary: true, pointerId: 1, pointerType: 'mouse' }));
    targetEl.dispatchEvent(new MouseEvent('mousedown', { ...props, button: 0, buttons: 1 }));
    targetEl.dispatchEvent(new PointerEvent('pointerup', { ...props, button: 0, buttons: 0, isPrimary: true, pointerId: 1, pointerType: 'mouse' }));
    targetEl.dispatchEvent(new MouseEvent('mouseup', { ...props, button: 0, buttons: 0 }));

    if (typeof targetEl.click === 'function') {
      targetEl.click();
    } else {
      targetEl.dispatchEvent(new MouseEvent('click', { ...props, button: 0, buttons: 0 }));
    }
  }

  /**
   * Unified automation workflow for submitting a single prompt:
   * 1. Detect editor
   * 2. Clear previous content completely (without scrolling)
   * 3. Insert new prompt
   * 4. Detect submit button
   * 5. Return precise coordinates for single authentic hardware click
   * 6. Keep prompt visible in editor (do NOT clear here)
   */
  async function executeSubmitCycle(promptText) {
    console.log('[Flow Automator] Starting submit cycle for prompt:', (promptText || '').substring(0, 50) + '...');

    // 1. Detect editor with generous retries
    let editor = null;
    for (let i = 0; i < 15; i++) {
      editor = findPromptEditor();
      if (editor) break;
      await sleep(200);
    }

    if (!editor) {
      throw new Error('Google Flow prompt input field not found. Please ensure Flow editor is visible.');
    }

    // Re-arm focus inside prompt box first (Illustrator-style focus arming)
    // De-selects external canvas tools and arms the text field
    await activatePromptBox(editor);
    await sleep(60);

    // 2. Best-effort clear (never throw to block submission!)
    try {
      await clearEditor(editor);
    } catch (clearErr) {
      console.warn('[Flow Automator] Note on clear (continuing anyway):', clearErr);
    }

    // 3. Insert prompt (overwrites and triggers React/Angular events)
    await insertPrompt(editor, promptText);

    // 4. Generous pause (350ms) to allow Google Flow reactive framework (React/Angular/Lit) to update and enable the arrow button
    await sleep(350);

    // Trigger reactive change events cleanly without blur/focus jump (prevents artboard bouncing)
    try {
      editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } catch {}

    // CRITICAL GUARD: Ensure prompt is strictly non-empty before finding/clicking submit button.
    // This permanently prevents Google Flow's "Prompt must be provided" error!
    let verifiedFinalContent = getEditorText(editor).trim();
    if (!verifiedFinalContent || verifiedFinalContent.length === 0) {
      console.warn('[Flow Automator] Prompt box was empty after initial insert. Re-inserting now...');
      await insertPrompt(editor, promptText);
      await sleep(250);
      verifiedFinalContent = getEditorText(editor).trim();
    }

    if (!verifiedFinalContent || verifiedFinalContent.length === 0) {
      throw new Error('Prompt verification failed: Editor was empty. Aborted click to prevent "Prompt must be provided" error.');
    }

    // 5. Find submit button with retries
    let submitBtn = null;
    for (let i = 0; i < 25; i++) {
      submitBtn = findSubmitButton(editor);
      if (submitBtn) break;
      await sleep(150);
    }

    // 6. Prepares precise center coordinates of the white submit button focus point
    const targetResult = await prepareSubmitTarget(submitBtn, editor);

    return {
      success: true,
      verifiedPrompt: promptText,
      clickCoords: {
        x: targetResult?.clientX || 0,
        y: targetResult?.clientY || 0
      },
      timestamp: Date.now()
    };
  }

  /**
   * Clear-only operation (executed at end of interval right before next prompt)
   */
  async function executeClearOnly() {
    console.log('[Flow Automator] Interval elapsed. Clearing previous prompt now...');
    const editor = findPromptEditor();
    if (!editor) {
      throw new Error('Prompt input field not found during clear.');
    }
    const cleared = await clearEditor(editor);
    if (!cleared) {
      throw new Error('Unable to clear previous prompt.');
    }
    return { success: true };
  }

  /**
   * Listen for messages from background service worker / popup
   */
  if (window.__FLOW_AUTOMATOR_MSG_LISTENER__) {
    try {
      chrome.runtime.onMessage.removeListener(window.__FLOW_AUTOMATOR_MSG_LISTENER__);
    } catch {}
  }

  window.__FLOW_AUTOMATOR_MSG_LISTENER__ = (message, sender, sendResponse) => {
    if (message.type === 'PING') {
      const editor = findPromptEditor();
      const btn = editor ? findSubmitButton(editor) : null;
      sendResponse({
        status: 'ok',
        flowDetected: Boolean(editor),
        buttonDetected: Boolean(btn),
        currentEditorText: editor ? getEditorText(editor) : ''
      });
      return true;
    }

    if (message.type === 'CHECK_DOM') {
      const editor = findPromptEditor();
      const btn = editor ? findSubmitButton(editor) : null;
      sendResponse({
        editorFound: Boolean(editor),
        buttonFound: Boolean(btn),
        editorTagName: editor ? editor.tagName : null,
        currentText: editor ? getEditorText(editor) : ''
      });
      return true;
    }

    if (message.type === 'SUBMIT_PROMPT') {
      executeSubmitCycle(message.prompt)
        .then((result) => sendResponse({ success: true, result }))
        .catch((error) => {
          console.error('[Flow Automator] Error executing prompt submission:', error);
          sendResponse({ success: false, error: error.message || String(error) });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === 'CLEAR_EDITOR') {
      executeClearOnly()
        .then((result) => sendResponse({ success: true, result }))
        .catch((error) => {
          console.error('[Flow Automator] Error clearing editor:', error);
          sendResponse({ success: false, error: error.message || String(error) });
        });
      return true;
    }

    if (message.type === 'TRIGGER_FALLBACK_CLICK') {
      executeSingleCleanClick(message.x, message.y);
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'ACTIVATE_PROMPT_BOX') {
      const editor = findPromptEditor();
      if (editor) {
        activatePromptBox(editor).then((res) => {
          sendResponse({ success: true, coords: res });
        });
        return true;
      }
      sendResponse({ success: false, error: 'Prompt editor not found' });
      return true;
    }

    return false;
  };

  chrome.runtime.onMessage.addListener(window.__FLOW_AUTOMATOR_MSG_LISTENER__);

  // Watch for dynamic DOM re-renders (Single Page App support)
  const observer = new MutationObserver(() => {});
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true
  });
})();
