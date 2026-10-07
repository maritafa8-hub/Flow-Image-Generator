/**
 * Flow Prompt Automator - Popup Controller
 * 
 * Manages the user interface, connects to the background service worker,
 * parses prompt files, and reflects live automation progress.
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const connectionBadge = document.getElementById('connectionBadge');
  const connectionText = document.getElementById('connectionText');
  
  const fileInput = document.getElementById('fileInput');
  const uploadBtn = document.getElementById('uploadBtn');
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  const promptCountDisplay = document.getElementById('promptCountDisplay');

  const intervalValueInput = document.getElementById('intervalValue');
  const intervalUnitSelect = document.getElementById('intervalUnit');

  const progressRatio = document.getElementById('progressRatio');
  const progressBarFill = document.getElementById('progressBarFill');
  const countdownDisplay = document.getElementById('countdownDisplay');

  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const stopBtn = document.getElementById('stopBtn');
  const resetBtn = document.getElementById('resetBtn');
  const clearPromptBtn = document.getElementById('clearPromptBtn');
  const clearListBtn = document.getElementById('clearListBtn');

  const promptListBadge = document.getElementById('promptListBadge');
  const promptListContainer = document.getElementById('promptListContainer');
  const togglePromptListBtn = document.getElementById('togglePromptListBtn');
  const togglePromptListText = document.getElementById('togglePromptListText');

  const statusMessage = document.getElementById('statusMessage');
  const errorBanner = document.getElementById('errorBanner');
  const refreshTabBtn = document.getElementById('refreshTabBtn');

  // Internal state mirror
  let currentState = null;
  let countdownTimerId = null;
  let isPromptListCollapsed = false;

  /**
   * Format seconds into MM:SS string
   */
  function formatTime(totalSeconds) {
    if (totalSeconds == null || isNaN(totalSeconds) || totalSeconds < 0) {
      return '--:--';
    }
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * Update the UI based on current state
   */
  function render(state, flowTabFound) {
    if (!state) return;
    currentState = state;

    // 1. Connection status
    if (flowTabFound) {
      connectionBadge.className = 'connection-badge status-online';
      connectionText.textContent = 'Flow detected';
      connectionBadge.title = 'Google Flow tab is active and ready';
    } else {
      connectionBadge.className = 'connection-badge status-offline';
      connectionText.textContent = 'Waiting for Flow...';
      connectionBadge.title = 'Please open Google Flow in a browser tab';
    }

    // 2. File info & Dynamic Cutting Queue
    const remainingCount = (state.prompts || []).length;
    const completedCount = state.completedCount || 0;
    const initialTotal = state.totalInitialPrompts || (remainingCount + completedCount);

    if (state.fileName && (remainingCount > 0 || completedCount > 0)) {
      fileNameDisplay.textContent = state.fileName;
      promptCountDisplay.textContent = `${remainingCount} left in queue`;
      promptCountDisplay.title = `${completedCount} submitted, ${remainingCount} remaining`;
    } else {
      fileNameDisplay.textContent = 'No file selected';
      promptCountDisplay.textContent = '0 in queue';
    }

    // 3. Interval inputs (only update if not currently focused to avoid interfering with user typing)
    if (document.activeElement !== intervalValueInput && document.activeElement !== intervalUnitSelect) {
      const totalSec = state.intervalSeconds || 30;
      if (totalSec >= 60 && totalSec % 60 === 0) {
        intervalValueInput.value = totalSec / 60;
        intervalUnitSelect.value = 'minutes';
      } else {
        intervalValueInput.value = totalSec;
        intervalUnitSelect.value = 'seconds';
      }
    }

    // 4. Progress (Submitted / Initial Total)
    progressRatio.textContent = `${completedCount} / ${initialTotal}`;

    const percent = initialTotal > 0 ? Math.min(100, (completedCount / initialTotal) * 100) : 0;
    progressBarFill.style.width = `${percent}%`;

    // 5. Buttons & Controls State Machine
    const isRunning = state.state === 'RUNNING_STEP' || state.state === 'WAITING_INTERVAL';
    const isPaused = state.state === 'PAUSED';
    const hasPrompts = remainingCount > 0 || (state.initialPromptsBackup && state.initialPromptsBackup.length > 0);

    if (isPaused) {
      startBtn.textContent = 'RESUME';
      startBtn.className = 'btn btn-primary btn-full';
      startBtn.disabled = !hasPrompts;
      pauseBtn.disabled = true;
      stopBtn.disabled = false;
    } else if (isRunning) {
      startBtn.textContent = 'RUNNING';
      startBtn.disabled = true;
      pauseBtn.textContent = 'PAUSE';
      pauseBtn.disabled = false;
      stopBtn.disabled = false;
    } else {
      // IDLE, STOPPED, COMPLETED, or ERROR
      startBtn.textContent = (state.state === 'COMPLETED' ? 'RESTART' : 'START');
      startBtn.disabled = !hasPrompts;
      pauseBtn.disabled = true;
      stopBtn.disabled = (state.state === 'IDLE' || state.state === 'COMPLETED');
    }

    resetBtn.disabled = (completedCount === 0 && !isPaused && !isRunning);

    // 6. Status text & Error banner
    statusMessage.textContent = state.statusText || 'Ready';

    if (state.lastError) {
      errorBanner.innerHTML = `${state.lastError} <span style="float: right; opacity: 0.8; font-weight: bold; margin-left: 6px; cursor: pointer;">✕</span>`;
      errorBanner.classList.remove('hidden');

      // Show quick reload button if it's a tab connection issue
      const isConnectionIssue = !flowTabFound ||
                                state.lastError.includes('not found') ||
                                state.lastError.includes('কানেকশন') ||
                                state.lastError.includes('Receiving end');
      if (refreshTabBtn) {
        if (isConnectionIssue) {
          refreshTabBtn.classList.remove('hidden');
        } else {
          refreshTabBtn.classList.add('hidden');
        }
      }
    } else {
      errorBanner.innerHTML = '';
      errorBanner.classList.add('hidden');
      if (refreshTabBtn) {
        refreshTabBtn.classList.add('hidden');
      }
    }

    // 7. Render Prompt List (Dynamic queue display)
    const promptList = state.prompts || [];
    if (promptListBadge) {
      promptListBadge.textContent = `${promptList.length} left`;
    }

    if (promptListContainer) {
      if (promptList.length === 0) {
        if (completedCount > 0) {
          promptListContainer.innerHTML = `<div class="prompt-list-empty" style="color: var(--accent-green);">✓ All ${completedCount} prompts successfully submitted!</div>`;
        } else {
          promptListContainer.innerHTML = `<div class="prompt-list-empty">No prompts in queue. Upload a TXT file above.</div>`;
        }
      } else {
        const isCurrentlyWorking = state.state === 'RUNNING_STEP' || state.state === 'WAITING_INTERVAL';
        promptListContainer.innerHTML = promptList.map((promptText, idx) => {
          const serialNum = completedCount + idx + 1;
          const isActive = idx === 0 && isCurrentlyWorking;
          const isNext = idx === 0 && !isCurrentlyWorking;
          const tagClass = isActive ? 'active' : 'queued';
          const tagLabel = isActive ? 'SUBMITTING' : (isNext ? 'NEXT' : 'QUEUED');
          const cleanText = promptText.replace(/"/g, '&quot;');

          return `
            <div class="prompt-item ${isActive ? 'active' : ''}" data-index="${idx}">
              <span class="prompt-index">#${serialNum}</span>
              <div class="prompt-text" title="${cleanText}">${promptText}</div>
              <span class="prompt-status-tag ${tagClass}">${tagLabel}</span>
              <button type="button" class="prompt-delete-btn" data-delete-index="${idx}" title="Remove prompt">✕</button>
            </div>
          `;
        }).join('');

        // Wire delete buttons
        promptListContainer.querySelectorAll('.prompt-delete-btn').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const deleteIdx = parseInt(btn.getAttribute('data-delete-index') || '0', 10);
            chrome.runtime.sendMessage({ type: 'DELETE_PROMPT', index: deleteIdx }, () => {
              refreshState();
            });
          });
        });
      }
    }

    // 8. Update countdown ticker
    updateCountdownTick();
  }

  /**
   * Countdown timer loop
   */
  function updateCountdownTick() {
    if (!currentState) return;

    if (currentState.state === 'WAITING_INTERVAL' && currentState.nextRunTimestamp) {
      const remainingMs = currentState.nextRunTimestamp - Date.now();
      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
      countdownDisplay.textContent = formatTime(remainingSec);
    } else if (currentState.state === 'PAUSED' && currentState.remainingSecondsOnPause != null) {
      countdownDisplay.textContent = formatTime(currentState.remainingSecondsOnPause);
    } else if (currentState.state === 'COMPLETED') {
      countdownDisplay.textContent = 'DONE';
    } else {
      countdownDisplay.textContent = '--:--';
    }
  }

  // Set up local interval for smooth ticking
  clearInterval(countdownTimerId);
  countdownTimerId = setInterval(updateCountdownTick, 500);

  /**
   * Request latest state from background
   */
  async function refreshState() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[Popup] Error getting state:', chrome.runtime.lastError.message);
          return;
        }
        if (response && response.state) {
          render(response.state, response.flowTabFound);
        }
      });
    } catch (err) {
      console.warn('[Popup] Refresh exception:', err);
    }
  }

  // Listen for broadcasted state updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATED' && message.state) {
      // Re-check tab presence quietly
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
        render(message.state, response ? response.flowTabFound : false);
      });
    }
  });

  /**
   * File Upload Handling
   */
  uploadBtn.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.txt')) {
      alert('Please select a valid .txt file.');
      fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      if (typeof text !== 'string') return;

      // Split into lines preserving content
      const lines = text.split(/\r?\n/);
      const prompts = [];

      for (let line of lines) {
        const trimmed = line.trim();
        // Ignore completely empty lines; preserve actual prompt text and punctuation
        if (trimmed.length > 0) {
          prompts.push(trimmed);
        }
      }

      if (prompts.length === 0) {
        alert('The uploaded file does not contain any valid prompts.');
        return;
      }

      chrome.runtime.sendMessage({
        type: 'LOAD_PROMPTS',
        prompts: prompts,
        fileName: file.name
      }, (response) => {
        if (response && response.state) {
          refreshState();
        }
      });
    };

    reader.readAsText(file, 'UTF-8');
    // Reset file input so re-selecting same file triggers change
    fileInput.value = '';
  });

  /**
   * Interval Input Change Handling
   */
  function handleIntervalChange() {
    let val = parseFloat(intervalValueInput.value);
    if (isNaN(val) || val <= 0) {
      val = 1;
      intervalValueInput.value = '1';
    }

    const unit = intervalUnitSelect.value;
    const totalSeconds = unit === 'minutes' ? Math.round(val * 60) : Math.round(val);

    chrome.runtime.sendMessage({
      type: 'SET_INTERVAL',
      intervalSeconds: totalSeconds
    }, () => {
      refreshState();
    });
  }

  intervalValueInput.addEventListener('change', handleIntervalChange);
  intervalUnitSelect.addEventListener('change', handleIntervalChange);

  /**
   * Button Click Handlers
   */
  startBtn.addEventListener('click', () => {
    if (currentState && currentState.state === 'PAUSED') {
      startBtn.textContent = 'RESUMING...';
      startBtn.disabled = true;
      statusMessage.textContent = 'Re-focusing prompt box and resuming...';
      chrome.runtime.sendMessage({ type: 'RESUME' }, () => refreshState());
    } else {
      // Immediate visual feedback so user sees it is actively working
      startBtn.textContent = 'RUNNING...';
      startBtn.disabled = true;
      pauseBtn.disabled = false;
      stopBtn.disabled = false;
      statusMessage.textContent = 'Submitting prompt to Google Flow...';

      chrome.runtime.sendMessage({ type: 'START' }, (response) => {
        if (response && response.error) {
          statusMessage.textContent = 'Error: ' + response.error;
        }
        refreshState();
      });
    }
  });

  pauseBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'PAUSE' }, () => refreshState());
  });

  stopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP' }, () => refreshState());
  });

  resetBtn.addEventListener('click', () => {
    if (confirm('Reset progress back to prompt 1?')) {
      chrome.runtime.sendMessage({ type: 'RESET' }, () => refreshState());
    }
  });

  if (clearListBtn) {
    clearListBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to clear all prompts from the list?')) {
        fileInput.value = '';
        chrome.runtime.sendMessage({ type: 'CLEAR_PROMPT_LIST' }, () => {
          refreshState();
        });
      }
    });
  }

  if (togglePromptListBtn && promptListContainer) {
    togglePromptListBtn.addEventListener('click', () => {
      isPromptListCollapsed = !isPromptListCollapsed;
      if (isPromptListCollapsed) {
        promptListContainer.classList.add('collapsed');
        if (togglePromptListText) togglePromptListText.textContent = 'Show List';
      } else {
        promptListContainer.classList.remove('collapsed');
        if (togglePromptListText) togglePromptListText.textContent = 'Hide List';
      }
    });
  }

  if (clearPromptBtn) {
    clearPromptBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'CLEAR_PROMPT_BOX' }, (response) => {
        if (response && response.error) {
          statusMessage.textContent = 'Error: ' + response.error;
        } else {
          statusMessage.textContent = 'Prompt box cleared in Google Flow.';
        }
      });
    });
  }

  if (refreshTabBtn) {
    refreshTabBtn.addEventListener('click', () => {
      statusMessage.textContent = 'Refreshing Google Flow tab...';
      if (errorBanner) errorBanner.classList.add('hidden');
      refreshTabBtn.disabled = true;
      chrome.runtime.sendMessage({ type: 'RELOAD_FLOW_TAB' }, () => {
        setTimeout(() => {
          refreshTabBtn.disabled = false;
          refreshState();
        }, 800);
      });
    });
  }

  if (errorBanner) {
    errorBanner.addEventListener('click', () => {
      errorBanner.classList.add('hidden');
      chrome.runtime.sendMessage({ type: 'CLEAR_ERROR' }, () => {
        refreshState();
      });
    });
  }

  // Initial load
  refreshState();
});
