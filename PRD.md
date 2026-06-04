# PRD — Chrome Recorder (extension-only)

**Status:** Draft  
**Date:** 2026-06-05

---

## 1. Overview

A browser extension for capturing technical bug context — console logs, network
requests, and user interactions — and exporting it as a self-contained ZIP. Visual
artifacts (screenshot, video) are optional additions to the debug payload.

No account. No server. No cloud. Everything stays on disk.

Forked from [crikket](https://github.com/redpangilinan/crikket). Full-stack monorepo
replaced by a single WXT extension.

---

## 2. Goals

- **Debug-first.** Console, network, and interaction capture are the primary value.
  Screenshot and video are optional additions.
- **Toggleable capture.** Each debug channel (console, network, interactions) can be
  turned on/off independently, both as persistent defaults and per-session.
- **Zero backend dependency.** Every byte of the report lives on the user's machine.
- **Chrome + Firefox.** One codebase, two build targets.
- **Ergonomic.** Filing a bug — start session, reproduce, stop, submit — should take
  under 60 seconds.

## 3. Non-goals

- No server, no auth, no dashboard, no sharing links.
- No webhook / third-party integrations (future work).
- No local history / report browser (future work).
- No video annotation.
- No GIF export.
- No mic audio — tab audio only.

---

## 4. Users

| Persona | Context |
|---|---|
| Frontend engineer | Captures console errors + network failures during reproduction; pastes ZIP into Jira/Linear |
| QA tester | Needs one-click session start + clear export; no manual DevTools |
| Designer | Screenshot + annotation for visual feedback on staging |

---

## 5. Features

### 5.1 Debug capture engine

The primary feature. Retained from crikket's `packages/capture-core/src/debugger/`,
vendored into `src/vendor/capture-core/`, and promoted to the core flow.

**Session-based.** Capture begins when the user starts a session and ends when they
stop it. Content scripts are injected at session start; torn down on stop/discard.

**Scope: current tab only.** Debug capture never runs on full-screen or window
recordings (no page context available there).

#### 5.1.1 Console capture

Intercepts `console.log / .warn / .error / .info / .debug`. Per entry:
- Level, message (serialised), timestamp, stack trace where available.

Toggle: **Console** (default: on).

#### 5.1.2 Network capture

Intercepts XHR and `fetch`. Per request:
- URL, method, status code, request + response headers, body (truncated to 10 kB),
  timing (start, duration).

Toggle: **Network** (default: on).

Default filter: **XHR + fetch only** (excludes static assets). Configurable in
settings — see §5.7.

#### 5.1.3 Interaction capture

Records user actions on the page. Per event:
- Type (click, input, navigation, scroll), target element selector, value (inputs
  only, redacted for `type=password`), timestamp.

Toggle: **Interactions** (default: off — opt-in).

---

### 5.2 DOM snapshots

Point-in-time capture of `document.documentElement.outerHTML`, saved as a
self-contained `.html` file.

#### Triggers

| Trigger | File name | When |
|---|---|---|
| Session start (automatic) | `dom-snapshot-start.html` | Immediately after content scripts are injected |
| On demand | `dom-snapshot-1.html`, `dom-snapshot-2.html`, … | User clicks **Snapshot DOM** in popup during active session |

Toggle: **DOM snapshots** (default: on). Controls both the auto-start capture and
the on-demand button.

#### Content

Each snapshot file is the full `outerHTML` prepended with a `<base href="<page-url>">` tag so relative URLs attempt to resolve when the file is opened locally.

Same-origin external stylesheets are fetched and inlined as `<style>` blocks.
Cross-origin stylesheets are skipped (CORS limitation — noted in a comment in the
file).

**Not captured:** canvas pixel data, computed styles, cross-origin images/fonts,
dynamic pseudo-element state.

#### Size

Large SPAs can produce 5–10 MB of raw HTML. No hard limit in v1; if `outerHTML`
exceeds 20 MB, show a warning in the submit form debug summary and still include
the file.

#### Implementation

Injected via `chrome.scripting.executeScript` into the active tab. Returns the
serialised HTML string to the background script, which stores it in session state
keyed by snapshot index. Included in the ZIP at export time.

---

### 5.3 Screenshot

Captured via `chrome.tabs.captureVisibleTab()` (Chrome) /
`browser.tabs.captureVisibleTab()` (Firefox via webextension-polyfill).

Can be taken:
- **During a session** — popup button "Take screenshot" while session is active.
- **Without a session** — standalone capture, debug payload is absent from the ZIP.

Opens the recorder tab in annotation mode (§5.4) before proceeding to the submit
form.

---

### 5.4 Video recording *(optional, secondary)*

Video is an optional visual artifact. The debug payload is the primary output.

#### 5.4.1 Tab video — Chrome
`chrome.tabCapture.getMediaStreamId()` → `getUserMedia`. Records active tab + tab
audio. Starts within an active session; debug capture runs in parallel.

#### 5.4.2 Tab video — Firefox fallback
`navigator.mediaDevices.getDisplayMedia({ preferCurrentTab: true })` (Firefox 116+).
User sees native picker pre-selected on current tab.

#### 5.4.3 Full-screen / window video
`getDisplayMedia({ video: true, audio: true })`. No debug payload (no tab context).
If user denies the browser prompt: inline error in recorder tab; tab stays open.

#### 5.4.4 Audio
Tab audio only, no mic. Muxed into the video blob by `MediaRecorder`.

**Pre-ship validation required:** verify `tabCapture` captures cross-origin iframe
audio on Chrome (e.g. embedded YouTube) before first release.

---

### 5.5 Screenshot annotation

Canvas-based overlay. Opens after screenshot capture, before the submit form.

Annotation is **ephemeral** — closing the tab mid-annotation loses the screenshot;
user must re-capture.

Tools (right-edge toolbar):

| Tool | Behaviour |
|---|---|
| **Arrow** | Click-drag; arrowhead at drag end |
| **Rectangle** | Click-drag outlined box |
| **Blur / Redact** | Click-drag region; pixelated overlay; non-reversible |
| **Colour picker** | Applies to Arrow + Rectangle. Default: red |
| **Undo** | Remove last annotation layer (stack-based) |
| **Clear all** | Reset to original screenshot |
| **Done** | Rasterise annotations into PNG blob; advance to form |

Implementation: Canvas 2D API, no third-party library.

---

### 5.6 Submit form

- **Title** (pre-filled from page title)
- **Description** (optional free text)
- **Notes** — free-form scratchpad, distinct from description. Intended for
  reproduction steps, hypotheses, or anything the user wants to append mid-session
  without committing to the final description. Saved to `notes.md` in the ZIP.

Shown alongside a live summary of captured debug data:

```
Console       12 entries  (3 errors)
Network       27 requests
Interactions   8 actions
DOM snapshots  2 files
Screenshot    attached
```

Each line links to an expandable preview of the captured data so the user can
verify before submitting.

---

### 5.7 ZIP export

Triggered on form submit. Built with **fflate** (wasm-free, ~10 kB gzipped).
Downloaded via `URL.createObjectURL` + `<a download>`. No `downloads` permission.

**ZIP structure:**

```
report-<ISO-timestamp>.zip
├── metadata.json             ← always present
├── console.json              ← if console capture on and has entries
├── network.json              ← if network capture on and has entries
├── interactions.json         ← if interactions capture on and has entries
├── dom-snapshot-start.html   ← if DOM snapshots on (auto at session start)
├── dom-snapshot-1.html       ← on-demand snapshots, if any
├── screenshot.png            ← if screenshot taken (annotated)
├── video.webm                ← if video recorded
└── notes.md                  ← if notes field is non-empty
```

Splitting debugger output into three discrete files (rather than a single
`debugger.json.gz`) makes the ZIP directly readable without tooling.

**`metadata.json` schema:**

```jsonc
{
  "title": "string",
  "description": "string | null",
  "url": "string | null",
  "pageTitle": "string | null",
  "timestamp": "ISO 8601",
  "sessionDurationMs": "number | null",
  "captureConfig": {
    "console": "boolean",
    "network": "boolean",
    "interactions": "boolean",
    "domSnapshots": "boolean",
    "hasScreenshot": "boolean",
    "hasVideo": "boolean"
  },
  "deviceInfo": {
    "browser": "string",
    "os": "string",
    "viewport": "string"
  }
}
```

---

### 5.8 Settings

Accessible from the popup footer ("Settings" link → opens options page).

#### Debug toggles (persistent defaults)

| Setting | Default | Description |
|---|---|---|
| Console capture | On | |
| Network capture | On | |
| Interaction capture | Off | Opt-in |
| DOM snapshots | On | Auto-capture at session start; enables on-demand button |

These are the defaults used when starting a new session. They can also be
overridden per-session from the popup before starting.

#### Network filter

| Setting | Default | Description |
|---|---|---|
| Capture mode | XHR + fetch only | Toggle to "All resources" to include static assets |
| URL exclusion patterns | _(empty)_ | Newline-separated glob patterns, e.g. `*/analytics/*`, `*/health` |
| Capture request bodies | On | Truncated at 10 kB |
| Capture response bodies | Off | Can be large; opt-in |

#### Network redaction

| Setting | Default | Description |
|---|---|---|
| Redact `Authorization` header | On | Replaced with `[REDACTED]` |
| Redact `Cookie` header | On | Replaced with `[REDACTED]` |
| Custom header redaction list | _(empty)_ | Additional headers to redact |

---

### 5.9 Popup UI

Two states:

**Idle (no active session):**
```
chrome-recorder

[ ● Start session ]

Console      [toggle]
Network      [toggle]
Interactions [toggle]
DOM snapshots [toggle]

[ Screenshot ]

Settings
```

**Active session:**
```
chrome-recorder

● Recording  0:42  |  12 console  27 network

[ ■ Stop & report ]

[ Take screenshot ]   [ Snapshot DOM ]   [ Record tab ▶ ]

Stop recording shortcut: Alt+Shift+S
```

Keyboard shortcuts:

| Shortcut | Action |
|---|---|
| `Alt+Shift+R` | Start session |
| `Alt+Shift+C` | Take screenshot (during session or standalone) |
| `Alt+Shift+S` | Stop session |

---

### 5.10 Permissions

```jsonc
{
  "permissions": [
    "activeTab",
    "scripting",
    "storage",
    "tabCapture",    // Chrome only — WXT strips for Firefox build
    "tabs"
  ],
  "host_permissions": ["<all_urls>"]
}
```

No `downloads` permission required.

---

## 6. Technical architecture

### Toolchain

| Tool | Choice |
|---|---|
| Framework | WXT 0.20+ |
| Bundler | Vite (via WXT) |
| Package manager | pnpm |
| UI | React 19 + Tailwind v4 + shadcn/ui |
| Language | TypeScript strict |
| Linter | Biome |
| ZIP | fflate |
| Canvas annotation | Canvas 2D API |

### Project structure

```
chrome-recorder/
├── src/
│   ├── entrypoints/
│   │   ├── background.ts               # session lifecycle, tab management
│   │   ├── popup/                      # popup UI (idle + active states)
│   │   ├── options/                    # settings page
│   │   ├── recorder/                   # submit form + debug summary + annotation
│   │   ├── debugger-content-bridge*    # from crikket (unchanged)
│   │   └── debugger-page*             # from crikket (unchanged)
│   ├── components/
│   │   ├── annotation/                 # canvas toolbar + tools
│   │   ├── debug-summary.tsx           # console/network/interactions preview
│   │   ├── form-step.tsx
│   │   ├── success-step.tsx
│   │   └── ...
│   ├── hooks/
│   ├── lib/
│   │   ├── bug-report-export.ts        # ZIP assembly
│   │   ├── capture-context.ts
│   │   ├── display-media.ts            # tabCapture + getDisplayMedia branches
│   │   ├── session.ts                  # session start/stop/state
│   │   └── bug-report-debugger/
│   └── vendor/
│       ├── capture-core/               # from crikket packages/capture-core/src/
│       └── shared/                     # from crikket packages/shared/src/
├── public/icon/
├── wxt.config.ts
├── package.json
├── tsconfig.json
└── biome.jsonc
```

### Cross-browser strategy

```bash
pnpm build          # → .output/chrome-mv3/
pnpm build:firefox  # → .output/firefox-mv2/
```

`tabCapture` vs `getDisplayMedia` branched at runtime:

```ts
const isFirefox = import.meta.env.BROWSER === "firefox"
export const requestTabCaptureStream = isFirefox
  ? requestViaDisplayMedia
  : requestViaTabCapture
```

WXT strips `tabCapture` from the Firefox manifest automatically.

---

## 7. Out of scope (future work)

- Webhook / integrations (Jira, Linear, Slack, GitHub Issues)
- Local report history
- Video trimming / editing
- Video annotation
- Mic audio
- GIF export
- Session replay (rrweb)
- Always-on ring-buffer capture mode
- Safari / Edge (should work via Chromium but untested)

---

## 8. Video recording storage (B + C + D)

Applies only when video recording is used (optional feature).

**C — Bitrate cap**

```ts
new MediaRecorder(stream, { videoBitsPerSecond: 2_000_000 })
```

Caps growth at ~15 MB/min theoretical; ~2–4 MB/min for typical UI content.

**D — OPFS streaming via dedicated Worker**

Use `FileSystemSyncAccessHandle` in a Worker (not `FileSystemWritableFileStream` on
main thread — async write backpressure at high chunk rates). Main thread posts each
`ondataavailable` chunk and awaits the ack for backpressure.

- Chrome bug: `createSyncAccessHandle` throws `NoModificationAllowedError` during
  GC of a prior handle. Retry: `[0, 200, 400, 600, 800] ms`.
- Close timeout scales with file size: `min(30s + 30s × ceil(sizeGb), 180s)`.
- Create new OPFS file before deleting old one (crash recovery).
- Sweep orphaned `recording-*.webm` files on extension startup.

**B — Size monitoring**

Worker returns `totalSize` in each write ack. Main thread surfaces it in the
recording indicator.

| Level | Threshold | Action |
|---|---|---|
| Soft warn | 100 MB | Yellow banner in popup |
| Hard stop | 500 MB | Auto-stop `MediaRecorder`; proceed to form with partial recording |

**ZIP assembly**

```
OPFS file → fileHandle.getFile() → file.stream() → fflate streaming Zip → Blob → download
```

Peak RAM: one fflate output chunk. No 2× spike.
