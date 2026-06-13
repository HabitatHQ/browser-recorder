# Browser Recorder

A browser extension (Chrome + Firefox) for capturing debug data and exporting self-contained browser recordings. No server, no account, no cloud.

Captures console logs, network requests, interactions, DOM snapshots, screenshots, and optional video — all bundled into a local ZIP. Includes an always-on **ring buffer** that keeps the last N minutes in the background, so you can capture what just happened without having started a session first.

Download the latest release from [Releases](../../releases). See [GUIDE.md](GUIDE.md) for installation and usage.

## Screenshot

Open the popup and start a session (or grab a one-off screenshot / DOM snapshot).

![Popup](docs/store/popup.png)

See [GUIDE.md](GUIDE.md#usage) for the full annotate → review → export flow and the settings screen.

## Development

```sh
pnpm install
pnpm dev        # Chrome (hot-reload via WXT)
pnpm build      # Chrome MV3 (unpacked)
pnpm package    # build + zip for distribution
pnpm check      # TypeScript
```

To install: load `.output/chrome-mv3/` as an unpacked extension in `chrome://extensions`. See [GUIDE.md](GUIDE.md#installation) for details.

Screenshots are generated from the built extension with `pnpm screenshots` (see [`scripts/capture-screenshots.mjs`](scripts/capture-screenshots.mjs)), which writes README/guide crops to `docs/screenshots/` and 1280×800 store-listing images to `docs/store/`.

## Publishing

See [PUBLISH.md](PUBLISH.md) for the Chrome Web Store build, upload, and listing workflow.

## Known gaps / TODO

See [TODOS.md](TODOS.md).

## Attribution

The capture engine in `src/vendor/capture-core/` is adapted from [crikket](https://github.com/redpangilinan/crikket) by [redpangilinan](https://github.com/redpangilinan).

## License

[AGPL-3.0](LICENSE). The vendored capture engine from crikket is also AGPL-3.0, which is why this license applies to the whole project.

## Stack

- [WXT](https://wxt.dev) — extension framework (Chrome MV3 + Firefox MV3)
- [React 19](https://react.dev) + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com)
- [fflate](https://github.com/101arrowz/fflate) — in-browser ZIP
- [Biome](https://biomejs.dev) — linting
