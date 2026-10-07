/**
 * Flow Prompt Automator - Background Service Worker (Manifest V3)
 * 
 * Orchestrates the prompt automation lifecycle:
 * - Independent of popup lifecycle (runs when popup is closed)
 * - Tolerant to service worker termination and restarts via chrome.storage.local reconciliation
 * - Robust background timing via chrome.alarms for minimized window resilience
 * - Clear state machine to prevent duplicate submissions or out-of-order execution
 */

const ALARM_NAME = 'flow_prompt_automator_interval';

// Enable Chrome Side Panel API to dock extension on the side of the browser
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

const DEFAULT_STATE = {
  prompts: [], // Active remaining prompt queue (each prompt is cut upon submission)
  fileName: '',
  totalInitialPrompts: 0,
  completedCount: 0,
  intervalSeconds: 30, // default 30 seconds
  state: 'IDLE', // IDLE, RUNNING_STEP, WAITING_INTERVAL, PAUSED, STOPPED, ERROR, COMPLETED
  statusText: 'Ready',
  nextRunTimestamp: null,
  remainingSecondsOnPause: null,
  lastError: null,
  lastSubmittedPrompt: null,
  lastSubmittedTime: null
};

// In-memory timer handle for active service worker execution
let activeTimer = null;

/**
 * Read current persisted state
 */
async function getState() {
  const data = await chrome.storage.local.get('flowAutomatorState');
  return { ...DEFAULT_STATE, ...(data.flowAutomatorState || {}) };
}

/**
 * Persist state to chrome.storage.local and broadcast to popup if listening
 */
async function setState(partial) {
  const current = await getState();
  const updated = { ...current, ...partial };
  await chrome.storage.local.set({ flowAutomatorState: updated });
  
  // Broadcast update to any open popup
  try {
    chrome.runtime.sendMessage({ type: 'STATE_UPDATED', state: updated }).catch(() => {
      // Popup not open; expected and harmless
    });
  } catch {
    // Ignore error if no listener
  }

  return updated;
}

/**
 * Helper to find active Google Flow tab across all browser windows
 */
async function findFlowTab() {
  try {
    const allTabs = await chrome.tabs.query({});
    if (!allTabs || allTabs.length === 0) return null;

    const isFlow = (t) => {
      if (!t) return false;
      const url = (t.url || '').toLowerCase();
      const title = (t.title || '').toLowerCase();
      if (url.includes('flow.google') || url.includes('labs.google') || url.includes('aitestkitchen') || url.includes('fx.google')) {
        return true;
      }
      if (url.includes('google.com') && (title.includes('flow') || title.includes('prompt') || title.includes('image generator'))) {
        return true;
      }
      return false;
    };

    // 1. Prioritize active Flow tab
    const activeFlow = allTabs.find(t => t.active && isFlow(t));
    if (activeFlow) return activeFlow;

    // 2. Any open Flow tab
    const anyFlow = allTabs.find(t => isFlow(t));
    if (anyFlow) return anyFlow;

    // 3. Fallback for localhost / local testing
    const local = allTabs.find(t => (t.url || '').includes('localhost') || (t.url || '').includes('127.0.0.1'));
    if (local) return local;
  } catch (err) {
    console.warn('[Flow Automator] Tab query failed:', err);
  }
  return null;
}

/**
 * Ensures content script is injected and responding in the Flow tab.
 * If the user opened the tab before installing or reloading the extension,
 * this dynamically injects content.js into the main top-level frame.
 */
async function ensureContentScriptReady(tabId) {
  const isResponding = await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'PING' }, (res) => {
      if (chrome.runtime.lastError) {
        // Expected when content script is not yet injected; mark error as handled
        resolve(false);
      } else {
        resolve(Boolean(res && res.status === 'ok'));
      }
    });
  });

  if (isResponding) return true;

  // Inject content script into the top frame only
  try {
    if (chrome.scripting && chrome.scripting.executeScript) {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      await new Promise((r) => setTimeout(r, 250));
      return true;
    }
  } catch (injectErr) {
    console.warn('[Flow Automator] Dynamic injection note:', injectErr);
  }

  return false;
}

/**
 * Clears any active memory timer and Chrome alarm
 */
async function clearSchedulers() {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  await chrome.alarms.clear(ALARM_NAME);
}

/**
 * Schedules the next prompt submission after the configured interval
 */
async function scheduleNextPrompt(delayMs) {
  await clearSchedulers();

  const nextTimestamp = Date.now() + Math.max(0, delayMs);
  await setState({
    state: 'WAITING_INTERVAL',
    nextRunTimestamp: nextTimestamp,
    remainingSecondsOnPause: null
  });

  // 1. Chrome alarm fallback (ensures wake-up even if service worker unloads or window is minimized)
  // chrome.alarms works with epoch milliseconds in 'when'
  await chrome.alarms.create(ALARM_NAME, {
    when: nextTimestamp
  });

  // 2. Active in-memory setTimeout for immediate precision if worker remains awake
  activeTimer = setTimeout(async () => {
    await clearSchedulers();
    await processNextPrompt();
  }, Math.max(50, delayMs));
}

/**
 * Submits the current prompt from the top of the queue and CUTS it from the list
 */
async function processCurrentPrompt() {
  const state = await getState();

  if (state.state === 'PAUSED' || state.state === 'STOPPED') {
    console.log('[Flow Automator] Execution is paused or stopped. Halting.');
    return;
  }

  // If queue is empty, we are done!
  if (!state.prompts || state.prompts.length === 0) {
    console.log('[Flow Automator] All prompts completed (queue empty)!');
    await setState({
      state: 'COMPLETED',
      statusText: `All prompts completed! (${state.completedCount} total submitted)`,
      nextRunTimestamp: null
    });
    return;
  }

  // Directly take the top prompt from the queue
  const promptToSubmit = state.prompts[0];
  const currentSubmitNumber = (state.completedCount || 0) + 1;
  const initialTotal = state.totalInitialPrompts || (state.completedCount + state.prompts.length);

  console.log(`[Flow Automator] Processing prompt #${currentSubmitNumber} (${state.prompts.length} remaining in queue)`);

  await setState({
    state: 'RUNNING_STEP',
    statusText: `Submitting prompt #${currentSubmitNumber} (${state.prompts.length} remaining in queue)...`,
    lastError: null
  });

  const flowTab = await findFlowTab();
  if (!flowTab || !flowTab.id) {
    console.warn('[Flow Automator] Google Flow tab not found.');
    await setState({
      state: 'ERROR',
      statusText: 'Google Flow tab not found. Please open flow.google.com in a tab.',
      lastError: 'Google Flow tab not found. Open flow.google.com'
    });
    return;
  }

  // Auto-inject content script if not already present in the tab
  await ensureContentScriptReady(flowTab.id);

  try {
    let response;
    try {
      response = await chrome.tabs.sendMessage(flowTab.id, {
        type: 'SUBMIT_PROMPT',
        prompt: promptToSubmit
      });
    } catch (sendErr) {
      const errText = sendErr ? (sendErr.message || String(sendErr)) : '';
      if (errText.includes('Receiving end does not exist') || errText.includes('Could not establish connection')) {
        console.log('[Flow Automator] Receiving end missing. Re-injecting content script and retrying...');
        await ensureContentScriptReady(flowTab.id);
        response = await chrome.tabs.sendMessage(flowTab.id, {
          type: 'SUBMIT_PROMPT',
          prompt: promptToSubmit
        });
      } else {
        throw sendErr;
      }
    }

    if (!response || !response.success) {
      const errMsg = (response && response.error) ? response.error : 'Submission failed in Flow tab.';
      console.error('[Flow Automator] Submission error from tab:', errMsg);
      await setState({
        state: 'ERROR',
        statusText: `Error: ${errMsg}`,
        lastError: errMsg
      });
      return;
    }

    const clickX = response?.result?.clickCoords?.x || response?.clickCoords?.x || 0;
    const clickY = response?.result?.clickCoords?.y || response?.clickCoords?.y || 0;

    // Execute STRICTLY ONE REAL HARDWARE MOUSE CLICK via Chrome DevTools Protocol (CDP)!
    // This provides an authentic OS-level mouse click (isTrusted: true) directly on the white focus point.
    let hardwareClickSuccess = false;
    if (clickX > 0 && clickY > 0 && chrome.debugger) {
      try {
        await chrome.debugger.attach({ tabId: flowTab.id }, '1.3');
        await chrome.debugger.sendCommand({ tabId: flowTab.id }, 'Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: Math.round(clickX),
          y: Math.round(clickY),
          button: 'left',
          clickCount: 1
        });
        await new Promise((r) => setTimeout(r, 60));
        await chrome.debugger.sendCommand({ tabId: flowTab.id }, 'Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: Math.round(clickX),
          y: Math.round(clickY),
          button: 'left'
        });
        await chrome.debugger.detach({ tabId: flowTab.id });
        hardwareClickSuccess = true;
        console.log('[Flow Automator] Exact single hardware click executed cleanly at', clickX, clickY);
      } catch (cdpErr) {
        console.warn('[Flow Automator] CDP hardware click note:', cdpErr);
      }
    }

    // Fallback: If CDP was unavailable or failed (e.g. devtools open), execute strictly 1 clean fallback click
    if (!hardwareClickSuccess && clickX > 0 && clickY > 0) {
      console.log('[Flow Automator] CDP unavailable. Dispatching strictly 1 clean fallback click to tab...');
      try {
        await chrome.tabs.sendMessage(flowTab.id, {
          type: 'TRIGGER_FALLBACK_CLICK',
          x: clickX,
          y: clickY
        });
      } catch (fallbackErr) {
        console.warn('[Flow Automator] Fallback click message note:', fallbackErr);
      }
    }

    // Successfully submitted with single clean precision click!
    // Prompt remains in the box inside the Flow tab until the countdown interval expires.
    const remainingQueue = state.prompts.slice(1);
    const newCompletedCount = (state.completedCount || 0) + 1;
    const now = Date.now();

    console.log(`[Flow Automator] Prompt #${newCompletedCount} submitted and CUT from queue. Remaining: ${remainingQueue.length}`);

    await setState({
      prompts: remainingQueue, // prompt list shrinks by 1
      completedCount: newCompletedCount,
      lastSubmittedPrompt: promptToSubmit,
      lastSubmittedTime: now,
      statusText: `Submitted #${newCompletedCount}. Queue: ${remainingQueue.length} left. Waiting interval...`
    });

    // Check if that was the last prompt in the queue
    if (remainingQueue.length === 0) {
      console.log('[Flow Automator] Reached final prompt. Queue is now completely empty.');
      await setState({
        state: 'COMPLETED',
        statusText: `Completed! All ${newCompletedCount} prompts submitted. Queue empty.`,
        nextRunTimestamp: null
      });
      return;
    }

    // Schedule the interval before clearing and submitting next prompt
    const intervalMs = (state.intervalSeconds || 120) * 1000;
    await scheduleNextPrompt(intervalMs);

  } catch (err) {
    console.error('[Flow Automator] Failed to communicate with Flow tab:', err);
    const errText = err ? (err.message || String(err)) : '';
    const isConnErr = errText.includes('Receiving end does not exist') || errText.includes('Could not establish connection');
    await setState({
      state: 'ERROR',
      statusText: isConnErr
        ? 'Connection lost. Check Flow tab.'
        : `Error: ${errText}`,
      lastError: isConnErr
        ? 'Flow ট্যাবের সাথে কানেকশন পাওয়া যাচ্ছে না। flow.google.com ট্যাবটি ওপেন রেখে START চাপুন।'
        : errText
    });
  }
}

/**
 * Called when the interval timer expires: processes the next prompt in the queue
 */
async function processNextPrompt() {
  const state = await getState();

  if (state.state === 'PAUSED' || state.state === 'STOPPED') {
    return;
  }

  if (!state.prompts || state.prompts.length === 0) {
    await setState({
      state: 'COMPLETED',
      statusText: 'All prompts completed.',
      nextRunTimestamp: null
    });
    return;
  }

  await processCurrentPrompt();
}

/**
 * Handle alarm triggering (rock-solid background scheduling for minimized window)
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('[Flow Automator] Interval alarm fired.');
    await clearSchedulers();
    const state = await getState();
    if (state.state === 'WAITING_INTERVAL') {
      await processNextPrompt();
    }
  }
});

/**
 * Message listener for actions from popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'GET_STATE': {
        const state = await getState();
        const flowTab = await findFlowTab();

        // Auto-clear stale connection / tab-not-found errors if Flow tab is detected
        if (flowTab && state.lastError && (
          state.lastError.includes('not found') ||
          state.lastError.includes('কানেকশন') ||
          state.lastError.includes('Receiving end') ||
          state.lastError.includes('Refresh')
        )) {
          state.lastError = null;
          if (state.state === 'ERROR') {
            state.state = 'IDLE';
            state.statusText = 'Ready';
          }
          await setState({ lastError: null, state: state.state, statusText: state.statusText });
        }

        sendResponse({ state, flowTabFound: Boolean(flowTab) });
        break;
      }

      case 'CLEAR_ERROR': {
        const state = await getState();
        const nextState = state.state === 'ERROR' ? 'IDLE' : state.state;
        const updated = await setState({
          lastError: null,
          state: nextState,
          statusText: state.state === 'ERROR' ? 'Ready' : state.statusText
        });
        sendResponse({ success: true, state: updated });
        break;
      }

      case 'LOAD_PROMPTS': {
        const { prompts, fileName } = message;
        await clearSchedulers();
        const list = prompts || [];
        const updated = await setState({
          prompts: [...list], // Cloned active queue (will be cut 1 by 1)
          initialPromptsBackup: [...list], // Kept safely for Reset
          fileName: fileName || 'prompts.txt',
          totalInitialPrompts: list.length,
          completedCount: 0,
          state: 'IDLE',
          statusText: `Loaded ${list.length} prompts. Ready to process and cut.`,
          nextRunTimestamp: null,
          remainingSecondsOnPause: null,
          lastError: null
        });
        sendResponse({ success: true, state: updated });
        break;
      }

      case 'SET_INTERVAL': {
        const seconds = Math.max(1, parseInt(message.intervalSeconds, 10) || 120);
        const state = await getState();
        // If currently waiting, adjust nextRunTimestamp if appropriate
        let nextRun = state.nextRunTimestamp;
        if (state.state === 'WAITING_INTERVAL' && state.lastSubmittedTime) {
          nextRun = state.lastSubmittedTime + (seconds * 1000);
          await scheduleNextPrompt(nextRun - Date.now());
        }
        const updated = await setState({ intervalSeconds: seconds });
        sendResponse({ success: true, state: updated });
        break;
      }

      case 'START': {
        await setState({ lastError: null });
        const state = await getState();
        if ((!state.prompts || state.prompts.length === 0) && (!state.initialPromptsBackup || state.initialPromptsBackup.length === 0)) {
          sendResponse({ success: false, error: 'No prompts loaded. Upload a TXT file first.' });
          return;
        }

        // If completed or stopped with empty queue, restore from initial backup
        if (state.state === 'COMPLETED' || (!state.prompts || state.prompts.length === 0)) {
          if (state.initialPromptsBackup && state.initialPromptsBackup.length > 0) {
            await setState({
              prompts: [...state.initialPromptsBackup],
              completedCount: 0
            });
          }
        }

        await processCurrentPrompt();
        sendResponse({ success: true, state: await getState() });
        break;
      }

      case 'RESUME': {
        const state = await getState();
        if (state.state !== 'PAUSED') {
          sendResponse({ success: false, error: 'Not currently paused.' });
          return;
        }

        const flowTab = await findFlowTab();
        if (flowTab && flowTab.id) {
          console.log('[Flow Automator] Resuming: Clicking inside prompt box to re-arm text input focus (Illustrator-style)...');
          try {
            await ensureContentScriptReady(flowTab.id);
            const actRes = await chrome.tabs.sendMessage(flowTab.id, { type: 'ACTIVATE_PROMPT_BOX' });
            
            // If CDP is available, also dispatch 1 real hardware click right inside the prompt box
            const boxX = actRes?.coords?.clientX || 0;
            const boxY = actRes?.coords?.clientY || 0;
            if (boxX > 0 && boxY > 0 && chrome.debugger) {
              try {
                await chrome.debugger.attach({ tabId: flowTab.id }, '1.3');
                await chrome.debugger.sendCommand({ tabId: flowTab.id }, 'Input.dispatchMouseEvent', {
                  type: 'mousePressed',
                  x: Math.round(boxX),
                  y: Math.round(boxY),
                  button: 'left',
                  clickCount: 1
                });
                await new Promise((r) => setTimeout(r, 40));
                await chrome.debugger.sendCommand({ tabId: flowTab.id }, 'Input.dispatchMouseEvent', {
                  type: 'mouseReleased',
                  x: Math.round(boxX),
                  y: Math.round(boxY),
                  button: 'left'
                });
                await chrome.debugger.detach({ tabId: flowTab.id });
                console.log('[Flow Automator] Prompt box hardware-clicked and activated on RESUME at', boxX, boxY);
              } catch (cdpErr) {
                console.warn('[Flow Automator] CDP box activation note:', cdpErr);
              }
            }
          } catch (actErr) {
            console.warn('[Flow Automator] Prompt box activation note:', actErr);
          }
        }

        if (state.remainingSecondsOnPause && state.remainingSecondsOnPause > 0) {
          // Resume countdown
          console.log(`[Flow Automator] Resuming countdown with ${state.remainingSecondsOnPause}s remaining.`);
          await setState({
            state: 'WAITING_INTERVAL',
            statusText: `Resumed. Waiting countdown (${state.remainingSecondsOnPause}s)...`,
            remainingSecondsOnPause: null
          });
          await scheduleNextPrompt(state.remainingSecondsOnPause * 1000);
        } else {
          // Resume current prompt submission
          await setState({
            state: 'RUNNING_STEP',
            statusText: 'Resumed. Submitting prompt...',
            remainingSecondsOnPause: null
          });
          await processCurrentPrompt();
        }

        sendResponse({ success: true, state: await getState() });
        break;
      }

      case 'PAUSE': {
        const state = await getState();
        let remaining = null;
        if (state.state === 'WAITING_INTERVAL' && state.nextRunTimestamp) {
          remaining = Math.max(1, Math.round((state.nextRunTimestamp - Date.now()) / 1000));
        }

        await clearSchedulers();
        const updated = await setState({
          state: 'PAUSED',
          statusText: 'Paused',
          remainingSecondsOnPause: remaining
        });
        sendResponse({ success: true, state: updated });
        break;
      }

      case 'STOP': {
        await clearSchedulers();
        const updated = await setState({
          state: 'STOPPED',
          statusText: 'Stopped',
          nextRunTimestamp: null,
          remainingSecondsOnPause: null
        });
        sendResponse({ success: true, state: updated });
        break;
      }

      case 'RESET': {
        await clearSchedulers();
        const state = await getState();
        const restored = (state.initialPromptsBackup && state.initialPromptsBackup.length > 0)
          ? [...state.initialPromptsBackup]
          : state.prompts;
        const updated = await setState({
          prompts: restored,
          completedCount: 0,
          state: 'IDLE',
          statusText: `Queue reset: ${restored.length} prompts restored to queue.`,
          nextRunTimestamp: null,
          remainingSecondsOnPause: null,
          lastError: null,
          lastSubmittedPrompt: null,
          lastSubmittedTime: null
        });
        sendResponse({ success: true, state: updated });
        break;
      }

      case 'CLEAR_PROMPT_BOX': {
        const tab = await findFlowTab();
        if (!tab || !tab.id) {
          sendResponse({ success: false, error: 'No active Google Flow tab found.' });
          break;
        }
        await ensureContentScriptReady(tab.id);
        chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_EDITOR' }, (res) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
          } else {
            sendResponse({ success: true, result: res });
          }
        });
        break;
      }

      case 'CLEAR_PROMPT_LIST': {
        await clearSchedulers();
        const updated = await setState({
          prompts: [],
          initialPromptsBackup: [],
          fileName: '',
          totalInitialPrompts: 0,
          completedCount: 0,
          state: 'IDLE',
          statusText: 'All prompts cleared. Ready for new TXT file.',
          nextRunTimestamp: null,
          remainingSecondsOnPause: null,
          lastError: null,
          lastSubmittedPrompt: null,
          lastSubmittedTime: null
        });

        // Also clear prompt in Flow tab if available
        try {
          const tab = await findFlowTab();
          if (tab && tab.id) {
            await ensureContentScriptReady(tab.id);
            chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_EDITOR' }).catch(() => {});
          }
        } catch {}

        sendResponse({ success: true, state: updated });
        break;
      }

      case 'DELETE_PROMPT': {
        const { index } = message;
        const state = await getState();
        const currentList = [...(state.prompts || [])];
        if (index >= 0 && index < currentList.length) {
          currentList.splice(index, 1);
          const updated = await setState({
            prompts: currentList,
            statusText: `Removed prompt #${index + 1}. ${currentList.length} remaining.`
          });
          sendResponse({ success: true, state: updated });
        } else {
          sendResponse({ success: false, error: 'Invalid prompt index' });
        }
        break;
      }

      case 'RELOAD_FLOW_TAB': {
        const tab = await findFlowTab();
        if (tab && tab.id) {
          chrome.tabs.reload(tab.id, () => {
            setState({ lastError: null, statusText: 'Flow page reloaded. Ready.' });
            sendResponse({ success: true });
          });
        } else {
          sendResponse({ success: false, error: 'No Flow tab found to reload.' });
        }
        break;
      }

      default:
        sendResponse({ error: 'Unknown action' });
    }
  })();

  return true; // Keep channel open for async response
});

/**
 * Service Worker Startup Reconciliation
 * When Chrome wakes the service worker back up, reconcile stored state
 */
async function reconcileStateOnWake() {
  const state = await getState();
  console.log('[Flow Automator] Service Worker woken. Reconciling state:', state.state);

  if (state.state === 'WAITING_INTERVAL') {
    const now = Date.now();
    if (state.nextRunTimestamp && now >= state.nextRunTimestamp) {
      console.log('[Flow Automator] Interval elapsed while worker was asleep. Processing next prompt.');
      await processNextPrompt();
    } else if (state.nextRunTimestamp) {
      const remainingMs = state.nextRunTimestamp - now;
      console.log(`[Flow Automator] Rescheduling remaining ${Math.round(remainingMs / 1000)}s.`);
      await scheduleNextPrompt(remainingMs);
    }
  }
}

chrome.runtime.onStartup.addListener(reconcileStateOnWake);
// Also run on script execution
reconcileStateOnWake();
