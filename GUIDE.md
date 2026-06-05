# Guide

## Installation

### Chrome

1. Extract the downloaded zip to a local folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (toggle, top-right).
4. Click **Load unpacked** and select the extracted folder.

### Firefox

1. Extract the downloaded zip to a local folder.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and select the `manifest.json` inside the folder.

The extension icon appears in the toolbar. Pin it for quick access.

---

## Usage

### Two ways to capture

There are two independent capture modes — use whichever fits the situation:

| Mode | When to use |
|---|---|
| **Session** | You know you're about to reproduce a bug. Start → reproduce → stop → export. |
| **Ring recording** | You didn't plan to record but something just went wrong. The ring buffer keeps the last N minutes silently in the background — just export what's already there. |

### Starting a session

Click the extension icon or press **Alt+Shift+R**. The icon badge turns red while recording is active.

Click the icon again (or press **Alt+Shift+S**) to stop the session. The report tab opens automatically — complete or close it to finish.

### Capture channels

All channels are independently toggled in the **popup** or the **Options page** (`chrome://extensions` → Chrome Recorder → Extension options).

| Channel | What it records |
|---|---|
| Console | `console.log/warn/error/info/debug` calls in page JS |
| Network | XHR and fetch requests/responses (body and headers configurable) |
| Interactions | Clicks, inputs, navigations — with CSS selectors and element metadata |
| DOM snapshots | Serialised page HTML with inlined same-origin styles |
| Screenshots | Manual captures with annotation canvas (arrow, rectangle, blur tools) |
| Video | Tab capture via MediaRecorder; streamed to OPFS (2 Mbps, 500 MB max) |

Enable **auto-capture** in Options to take a DOM snapshot and/or screenshot automatically after each recorded interaction.

### Ring recording

Ring recording is an always-on buffer that continuously captures the last N minutes in the background, without a formal session.

**To enable:** open the popup and toggle **Ring recording** on. The buffer starts immediately on the current tab and follows you as you switch tabs. A live count of buffered events is shown below the toggle.

**To export:** click **Export ring** in the popup. The report tab opens pre-populated with the buffered data — add a title and any notes, then export the ZIP.

Ring recording captures the same data as a session (console, network, interactions, and optionally video on Chrome). Configure the buffer duration separately for data and video in **Options → Ring recording** (default: 5 minutes each).

> **Note:** ring video pauses while a session with video recording is active, since both share the same capture mechanism. Data buffering (console/network/interactions) is unaffected.

### Taking a screenshot

Press **Alt+Shift+C** or click **Screenshot** in the popup. The annotation canvas opens — draw arrows, rectangles, or apply blur before saving.

Screenshots taken outside a session are included if a session is started before exporting.

### Exporting

Click **Export ZIP** in the report tab. A self-contained `.zip` is saved locally — named `browser-recording-{title}-{date}.zip` — containing:

- `console.json` — console entries
- `network.json` — network requests
- `interactions.json` — interaction events
- `dom/` — HTML snapshots
- `screenshots/` — annotated PNG files
- `video.webm` — (if video was enabled)
- `metadata.json` — browser, OS, viewport, active extensions, uncaught exceptions
- `README.md` — summary of the session

No data leaves the device.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Alt+Shift+R | Start session |
| Alt+Shift+S | Stop session and open report |
| Alt+Shift+C | Take screenshot |

Shortcuts can be changed at `chrome://extensions/shortcuts`.

### Console capture: what's included and what isn't

The interceptor wraps `console.log/warn/error/info/debug` in the page's JS context. It only covers calls made **after a session is started**.

**Not captured:**

- Browser-native DevTools entries — `ERR_BLOCKED_BY_CLIENT`, preload warnings, deprecation notices injected by Chrome itself never pass through the JS `console` API.
- Anything logged before the session starts — page-load output, framework initialisation, etc.

**Captured:**

- Any `console.*` call in page JS that fires after you click **Start session**.

For pre-session or browser-native entries, attach Chrome DevTools and use the built-in console panel.
