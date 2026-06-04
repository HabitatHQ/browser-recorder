# chrome-recorder

A Chrome extension for capturing debug data and exporting self-contained bug reports. No server, no account, no cloud.

## Features

- **Console** — logs, warnings, errors
- **Network** — XHR/fetch requests and responses (configurable body capture, header redaction)
- **Interactions** — clicks, inputs, navigations with full CSS selector paths and element metadata
- **DOM snapshots** — serialised page HTML with inlined same-origin styles; optionally auto-captured after each interaction
- **Screenshots** — multiple per session, with an annotation canvas (arrow, rectangle, blur); optionally auto-captured after each interaction
- **Video recording** — optional tab capture via MediaRecorder, streamed to OPFS (2 Mbps cap, 500 MB hard stop)
- **ZIP export** — all artifacts bundled locally via [fflate](https://github.com/101arrowz/fflate)

All capture channels are independently toggleable in the popup and the Options page. Everything stays on-device.

## What console capture does and doesn't catch

The console interceptor wraps `console.log / warn / error / info / debug` in the page's JavaScript context. It only covers calls made **after a session is started**.

**Not captured:**

- Browser-native DevTools entries — `ERR_BLOCKED_BY_CLIENT`, preload warnings, deprecation notices, and similar messages are injected directly into DevTools by Chrome itself, never going through the JS `console` API. No JS-level interceptor can reach them.
- Anything logged before the session starts — page-load console output, framework initialisation logs, etc. are already gone by the time the interceptor is installed.

**Captured:**

- Any `console.*` call in page JS that fires after you click **Start session** — errors from form submissions, JS exceptions, application logs, etc.

If you need pre-session or browser-native console entries, attach Chrome DevTools manually and use the built-in console panel.

## Known gaps / TODO

- **Crash resilience** — console, network, screenshots, and DOM snapshots live in `chrome.storage.session`; a browser crash silently wipes them. Video is the only artifact streamed to OPFS. All session data should be persisted to OPFS so a mid-session crash is recoverable.
- **Local report history** — once a ZIP is exported it's gone from the extension. There is no way to reopen, search, or annotate past reports. A persistent local store (IndexedDB or OPFS) indexed by session would make this a genuinely local-first tool rather than a one-shot exporter.
- **Always-on ring buffer** — you have to decide to record before the bug happens. A rolling N-minute buffer that can be saved retroactively would cover unplanned captures.
- **Self-contained report viewer** — the ZIP is readable if you unzip it, but there is no viewer. Bundling a single-file `report.html` inside the ZIP (no server, opens in browser) would make exports useful to non-developers.
- **WebSocket traffic** — only XHR and fetch are intercepted. Apps that use WebSockets for real-time communication produce no network entries.

Not planned (noted for completeness): localStorage / sessionStorage snapshot.

## Development

```sh
pnpm install
pnpm dev        # Chrome (hot-reload via WXT)
pnpm build      # Chrome MV3
pnpm check      # TypeScript
```

Load `.output/chrome-mv3/` as an unpacked extension in `chrome://extensions`.

## Attribution

The capture engine in `src/vendor/capture-core/` is adapted from [crikket](https://github.com/redpangilinan/crikket) by [redpangilinan](https://github.com/redpangilinan).

## License

[AGPL-3.0](LICENSE). The vendored capture engine from crikket is also AGPL-3.0, which is why this license applies to the whole project.

## Stack

- [WXT](https://wxt.dev) — extension framework (Chrome MV3)
- [React 19](https://react.dev) + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com)
- [fflate](https://github.com/101arrowz/fflate) — in-browser ZIP
- [Biome](https://biomejs.dev) — linting
