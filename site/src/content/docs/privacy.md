---
title: Privacy Policy
description: How Browser Recorder stores authorized captures locally, handles explicit request replay, and limits transmission and retention.
---

_Last updated: 2026-10-03_

Browser Recorder is a local-first browser extension for capturing debugging
information. This policy covers the extension. The separate command-line tool
captures raw browser data through different mechanisms; see the
[CLI documentation](https://github.com/HabitatHQ/browser-recorder/blob/main/cli/README.md)
before using it.

## The short version

Browser Recorder collects selected browser data locally only when you authorize
a capture: for example, by starting a session, taking a screenshot or DOM
snapshot, using dictation, or enabling ring recording for permitted sites. It
has no operator account, cloud capture service, or automatic telemetry upload.

Exporting creates a file that you choose to save and control. Creating that file
does not by itself transmit it. If you later share an export or downloaded
artifact, its handling is outside Browser Recorder's control.

There is one important intentional network action: **Replay request** sends the
method, URL, headers, and body you choose to the target from the recorded page.
It includes that page's live session credentials, such as cookies, and can
change data or trigger other side effects on the target. Browser Recorder
therefore does not promise that it makes no network requests.

## What the extension can capture

Depending on the controls you enable, a capture may include:

- Console messages, uncaught errors, and unhandled rejections
- Network request and response URLs, headers, bodies, status, and timing
- WebSocket and Server-Sent Events lifecycle data and frames
- Clicks, input changes, navigation, scrolling, selectors, and element metadata
- DOM snapshots, manual screenshots, annotations, and optional tab or
  user-selected-surface video
- Report metadata such as the page URL and title, browser and operating system,
  viewport, active service workers, and an inventory of other installed
  extensions
- Optional experimental rrweb session replay, which records DOM state,
  mutations, and user input for playback; this is off by default
- Optional beta performance capture, including Web Vitals, long tasks,
  navigation and resource timing, JavaScript heap information where available,
  and frame-rate samples; this is off by default
- Capture-health diagnostics and recent internal extension errors used to
  explain missing or failed capture channels; these may contain URLs or error
  text

Standalone screenshots and DOM snapshots are separately authorized actions; they
do not inherit the settings of a recording session.

Dictation is available only when the browser's speech-recognition API exposes
explicit local processing. Browser Recorder sets local processing on each
recognition request. If that capability is absent or recognition fails,
dictation is unavailable or stops; the extension does not fall back to remote
speech recognition.

## Capture controls and ring recording

Ordinary sessions capture only after you start them. Console, network, and
interaction capture are enabled by default. You can request DOM snapshots during
a session or separately; automatic snapshots on interaction are off by default.
Network request and response body capture is on by default. Body previews are
bounded, recognized sensitive fields are redacted, and oversized or unparseable
bodies may be omitted. Recognized sensitive headers such as cookies and
authorization are omitted by default. These controls are configurable, and
network redaction is not a guarantee that every secret is found. Video,
experimental replay, and beta performance capture are individually configurable;
video is off by default.

Ring recording is also off by default. Its default data and video windows are
five minutes, and its persistent allowlist starts empty. If you turn the ring on
with that empty allowlist, the extension session-pins the currently focused
site so the choice has an immediate, visible scope. Site pins are held in
browser session storage and clear on browser restart. The ring follows eligible
focused tabs, prunes data to its configured rolling window during operation and
restoration, and is suspended while an explicit recording session is active.

Ring event data is persisted locally so it can survive a service-worker or
browser restart and then age out of the rolling window. Ring video is best
effort: it is kept in memory, follows the focused tab, and can be lost on a
focus change, capture failure, or crash.

## Sensitive data and redaction limits

Capture artifacts can contain credentials, personal data, confidential page
content, and typed text. Browser Recorder applies automatic redaction rules to
captured network data and lets you review detected fields, redact selected
fields, remove an entire network entry, and exclude artifact categories before
export. These controls are defense in depth, not a guarantee that an artifact is
safe to share.

The network sanitizer does not sanitize screenshots, video, DOM snapshots,
console output, interaction metadata, performance data, diagnostics, or rrweb
replay events. Session replay separately masks textual native input, textarea,
and select values, plus text in elements marked `contenteditable` unless marked
`contenteditable="false"`, before events leave the page. Masking is best effort:
checkbox/radio values, select option labels, ordinary page text and attributes,
custom widgets, and data copied elsewhere can still reveal sensitive information.
It does not change live page values or retroactively mask existing recordings.
Experimental replay remains off by default. Review the complete report before
sharing it.

Request replay returns the live response to the extension UI without applying
capture/export redaction to that response. The replay result is not directly
appended to the recorded session or export, but ordinary capture hooks may still
record the request when capture is active. The target receives the request with
the live page's credentials. Review its URL, method, headers, and body before
sending it.

## Local storage, retention, and cleanup

- Capture, network-filter, video, and ring settings are stored persistently in
  the browser's local extension storage.
- Active session metadata is stored in browser session storage with a
  crash-recovery backup in local extension storage.
- Session events, screenshots, DOM snapshots, experimental replay events, and
  video are stored in the browser's Origin Private File System (OPFS).
  Standalone screenshots and DOM snapshots also use OPFS while awaiting review.
- Per-session capture diagnostics use session storage. A bounded recent internal
  error log uses local extension storage so it can survive service-worker
  restarts.

OPFS files and the local metadata backup may survive a service-worker restart,
browser restart, or crash. Recovery uses what was successfully persisted and is
best effort; Browser Recorder does not guarantee complete recovery.

Cleanup occurs at specific lifecycle points and is also best effort. Discarding
a session clears its metadata and attempts to remove its event, screenshot, DOM,
and replay files. Closing the report clears active-session metadata; a later
background startup sweeps extension-owned OPFS files that no active session owns.
Disabling ring recording clears its in-memory event buffers and persisted ring
event file, while out-of-window ring events are pruned during normal use and
restoration. Failed cleanup, crashes, video files, or browser storage behavior
can delay or prevent removal, so the extension does not promise immediate or
complete automatic erasure.

An exported ZIP or separately downloaded video, screenshot, or DOM snapshot
persists independently until you delete it using your operating system. Browser
storage controls and uninstall behavior are managed by the browser.

## Network behavior

Browser Recorder does not automatically send captured content, settings,
diagnostics, or telemetry to the project operator, and the project operates no
backend that receives captures. The recorded page and browser can continue their
normal network activity. An explicit request replay sends the chosen request to
its target as described above; exporting alone is a local file operation.

## Permissions and browser-specific capture

The extension requires broad host access to all URLs, plus tab, scripting,
storage, and related permissions, so it can capture an authorized page and
perform an explicitly requested replay. The `management` permission reads the
names, versions, and enabled state of other installed extensions for the report
inventory.

On Chrome, video capture uses `tabCapture` and an offscreen extension document.
On Firefox, where those APIs are unavailable, the extension opens a dedicated
capture page and the browser's `getDisplayMedia` picker lets you choose the
surface. These permissions and mechanisms enable local capture; they are not an
automatic upload channel. Per-permission justifications are documented in
[PUBLISH.md](https://github.com/HabitatHQ/browser-recorder/blob/main/PUBLISH.md).

## Your responsibility when sharing

Review every artifact before sharing it. Once you send a ZIP, video, screenshot,
DOM snapshot, or other export to another person or service, that recipient's
privacy and retention practices apply.

## Changes

If this policy changes, the updated version will be published in this repository
with a new "Last updated" date.

## Contact

Questions: open an issue at
<https://github.com/HabitatHQ/browser-recorder/issues>.
