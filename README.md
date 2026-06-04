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
