# chrome-recorder

A Chrome extension for capturing debug data and exporting self-contained bug reports. No server, no account, no cloud.

Captures console logs, network requests, interactions, DOM snapshots, screenshots, and optional video — all bundled into a local ZIP.

Download the latest release from [Releases](../../releases). See [GUIDE.md](GUIDE.md) for installation and usage.

## Development

```sh
pnpm install
pnpm dev        # Chrome (hot-reload via WXT)
pnpm build      # Chrome MV3 (unpacked)
pnpm package    # build + zip for distribution
pnpm check      # TypeScript
```

To install: load `.output/chrome-mv3/` as an unpacked extension in `chrome://extensions`. See [GUIDE.md](GUIDE.md#installation) for details.

## Known gaps / TODO

- **Crash resilience** — console, network, screenshots, and DOM snapshots live in `chrome.storage.session`; a browser crash silently wipes them. Video is the only artifact streamed to OPFS. All session data should be persisted to OPFS so a mid-session crash is recoverable.
- **Local report history** — once a ZIP is exported it's gone from the extension. There is no way to reopen, search, or annotate past reports. A persistent local store (IndexedDB or OPFS) indexed by session would make this a genuinely local-first tool rather than a one-shot exporter.
- **Always-on ring buffer** — you have to decide to record before the bug happens. A rolling N-minute buffer that can be saved retroactively would cover unplanned captures.
- **Self-contained report viewer** — the ZIP is readable if you unzip it, but there is no viewer. Bundling a single-file `report.html` inside the ZIP (no server, opens in browser) would make exports useful to non-developers.
- **WebSocket traffic** — only XHR and fetch are intercepted. Apps that use WebSockets for real-time communication produce no network entries.

Not planned (noted for completeness): localStorage / sessionStorage snapshot.

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
