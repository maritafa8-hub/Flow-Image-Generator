# Flow Prompt Automator (Chrome Extension MV3)

A production-grade, reliable Google Chrome extension for automating sequential image-generation prompt submission in **Google Flow**.

Built strictly in accordance with Manifest V3 specifications with background scheduling, persistent state storage, and dynamic DOM detection.

---

## 1. Core Architecture

The extension is architected around a non-blocking, decoupled 3-tier structure:

1. **Popup UI (`popup.html`, `popup.css`, `popup.js`)**
   - Clean, minimal, modern dark theme designed to fit Google Flow.
   - Provides controls: TXT file upload, interval setting, progress tracker, Start, Pause, Resume, Stop, and Reset.
   - Does **not** control the timer or lifecycle. The popup can be closed or reopened at any moment without interrupting the automation.

2. **Background Service Worker (`background.js`)**
   - Owns the automation lifecycle and queue state machine (`IDLE`, `RUNNING_STEP`, `WAITING_INTERVAL`, `PAUSED`, `STOPPED`, `ERROR`, `COMPLETED`).
   - Persists state in `chrome.storage.local`. If the service worker is suspended by Chrome or the browser is minimized, state is safely preserved.
   - Uses `chrome.alarms` in combination with high-precision memory timeouts for reliable background scheduling that survives tab throttling and window minimization.
   - Dispatches execution commands to the Google Flow tab's content script.

3. **Content Script (`content.js`)**
   - Directly executes DOM-level operations inside Google Flow (`https://flow.google/*`, `https://labs.google/*`, etc.).
   - Employs resilient, multi-tier fallback detection for textareas, `contenteditable="true"` containers, shadow DOM hosts, and ARIA roles.
   - Triggers React/Angular-compatible input events via native prototype property setters and `InputEvent`.
   - **Crucial Prompt Replacement Cycle**:
     - Inserts the prompt into the Flow input.
     - Verifies complete content match.
     - Clicks the submit/GO button.
     - **Keeps the submitted prompt visible** throughout the user-defined interval.
     - Only after the interval expires: focuses, selects all, clears completely, and verifies that the editor is 100% empty (`actualText.trim() === ""`).
     - Inserts the next prompt and repeats.
     - **Never appends or mixes prompts.**

---

## 2. Directory Structure

```
flow-prompt-automator/
│
├── manifest.json       # Manifest V3 configuration and permissions
├── popup.html          # Clean, modern extension popup UI
├── popup.css           # Minimal dark theme styling
├── popup.js            # Popup controller and file parser
├── background.js       # Background service worker & scheduling engine
├── content.js          # Google Flow DOM detection & event automation
├── icons/              # Extension action icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md           # Documentation and installation guide
```

---

## 3. Chrome Permissions Explanation

The extension requests only the minimum required permissions:

- **`storage`**: Used by `chrome.storage.local` to persist prompt queues, current index, configured interval, countdown timestamps, and error states. This guarantees that closing the popup or restarting the service worker preserves your progress.
- **`alarms`**: Used by `chrome.alarms` for background scheduling. Unlike plain `setTimeout` which Chrome throttles in background tabs or minimized windows, `chrome.alarms` triggers consistently to advance the queue.
- **`tabs`**: Used to locate the active Google Flow tab and communicate with the injected content script.
- **`host_permissions`** (`https://flow.google/*`, `https://labs.google/*`, `https://*.google.com/*`): Limits content script injection strictly to Google Flow / Google Labs domains without accessing unrelated websites.

---

## 4. Installation Instructions (Step-by-Step)

Follow these steps to install the extension manually in Google Chrome:

1. **Extract or Prepare the Project Folder**:
   - Ensure all files (`manifest.json`, `popup.html`, `popup.css`, `popup.js`, `background.js`, `content.js`, `icons/`, and `README.md`) reside together in a folder named `flow-prompt-automator`.
2. **Open Chrome Extension Management**:
   - In Google Chrome, navigate to `chrome://extensions/` (or click Chrome Menu `⋮` → **Extensions** → **Manage Extensions**).
3. **Enable Developer Mode**:
   - In the top-right corner of the Extensions page, toggle the **Developer mode** switch to **ON**.
4. **Load Unpacked Extension**:
   - Click the **"Load unpacked"** button in the top-left toolbar.
   - In the file picker dialog, select the `flow-prompt-automator` folder and click **Select Folder**.
5. **Pin the Extension**:
   - Click the puzzle piece icon (Extensions) in your Chrome toolbar.
   - Click the pin icon next to **Flow Prompt Automator** for quick access.

---

## 5. How to Run Prompt Automation

1. **Open Google Flow**:
   - Open [Google Flow](https://flow.google/) (or your active Google Labs generation session) in a Chrome tab.
   - Make sure you are logged in and the prompt box is visible on the page.
2. **Open the Extension Popup**:
   - Click the **Flow Prompt Automator** icon in your toolbar.
   - The connection badge in the top-right will indicate:
     - `● Flow detected` (in green) when your Google Flow tab is detected.
3. **Upload Prompts TXT File**:
   - Click **"Choose TXT File"**.
   - Select a UTF-8 text file containing prompts (one prompt per line).
   - Empty lines are automatically ignored; prompt text, punctuation, and Unicode (e.g. English, Bengali, emojis) are strictly preserved.
4. **Configure Interval**:
   - Specify your desired delay (e.g. `2 Minutes` or `30 Seconds`).
   - This defines the wait time between successive prompt submissions.
5. **Start Automation**:
   - Click **START**.
   - The extension will automatically:
     1. Insert Prompt 1.
     2. Verify text in Flow's editor.
     3. Click GO / Submit.
     4. Keep Prompt 1 in the box and count down the interval.
     5. Clear Prompt 1 completely and verify the editor is empty.
     6. Insert Prompt 2, verify, and click GO.
     7. Continue until all prompts are completed.
6. **Background & Minimized Window Operation**:
   - You can close the popup or minimize Chrome. The service worker and alarms continue processing in the background.

---

## 6. Debugging & Inspecting Console Logs

If you want to view the real-time execution logs:

1. **Google Flow Tab Console (DOM interaction & verification)**:
   - On the Google Flow tab, press `F12` (or `Cmd+Option+I` on Mac) to open DevTools.
   - Look for logs prefixed with `[Flow Automator]`, such as:
     - `[Flow Automator] Flow page detected`
     - `[Flow Automator] Field successfully cleared and verified empty.`
     - `[Flow Automator] Prompt inserted and verified successfully.`
     - `[Flow Automator] Submit clicked. Keeping submitted prompt visible in input field.`

2. **Background Service Worker Console (Lifecycle & Alarms)**:
   - Go to `chrome://extensions/`.
   - Under **Flow Prompt Automator**, click the link that says **"service worker"** (under *Inspect views*).
   - A dedicated DevTools window will open showing service worker scheduling, state changes, and alarm triggers.

3. **Popup Console (UI)**:
   - Right-click anywhere inside the extension popup and click **Inspect**.

---

## 7. Customizing DOM Selectors

If Google Flow updates its web interface or changes CSS class names, you can easily adjust the centralized selectors in `content.js`:

```javascript
const SELECTORS = {
  promptEditors: [
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea[aria-label*="prompt" i]',
    'textarea[placeholder*="prompt" i]',
    'textarea',
    // Add custom selectors here if needed:
    // '#my-custom-prompt-input'
  ],
  submitButtons: [
    'button[aria-label*="generate" i]',
    'button[aria-label*="submit" i]',
    'button[type="submit"]',
    // Add custom selectors here if needed:
  ]
};
```

To find the selector in Chrome DevTools: right-click the prompt field in Google Flow → **Inspect** → right-click the highlighted element in the Elements panel → **Copy** → **Copy selector**.
