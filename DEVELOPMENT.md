# Development

Everything you need to build, test, and ship the extension or the CLI from source.

## Layout

This is a pnpm workspace with two packages:

| Path | Package | Purpose |
|---|---|---|
| `src/`, `public/`, `wxt.config.ts` | `browser-recorder` (root) | The browser extension (WXT + React 19) |
| `cli/` | `@browser-recorder/cli` | Node CLI that captures via Playwright/CDP |
| `packages/core` | `@browser-recorder/core` | Shared types + report builders used by both |

The capture engine in `src/capture-core/` is adapted from [crikket](https://github.com/redpangilinan/crikket) by [redpangilinan](https://github.com/redpangilinan) (AGPL-3.0, which is why this whole project is AGPL-3.0). It has since been substantially extended, so it lives in the main source tree rather than a `vendor/` directory — the attribution stands because the original code remains its basis.

## Prerequisites

- Node ≥ 20
- pnpm ≥ 9
- A Chromium-based browser for loading the unpacked extension

## Install

```sh
pnpm install
```

The root `postinstall` runs `wxt prepare`, which generates `.wxt/` type stubs. Do not commit `.wxt/`.

## Common scripts (root)

```sh
pnpm dev               # Chrome, hot-reload via WXT (port 5555)
pnpm dev:firefox       # Firefox, hot-reload via WXT
pnpm build             # Chrome MV3, unpacked to .output/chrome-mv3/
pnpm build:firefox     # Firefox MV3, unpacked to .output/firefox-mv3/
pnpm zip               # Chrome zip (distributable)
pnpm zip:firefox       # Firefox zip (distributable)
pnpm package           # Both zips in one command
pnpm check             # TypeScript (tsc --noEmit)
pnpm test              # vitest run
pnpm test:watch        # vitest
pnpm lint              # biome check src
```

To load the built extension:

- Chrome: open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select `.output/chrome-mv3/`.
- Firefox: open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, select `manifest.json` inside `.output/firefox-mv3/`. (Temporary add-ons are removed on browser restart.)

## CLI (workspace package)

The CLI lives in `cli/` and is documented in [cli/README.md](cli/README.md). To work on it:

```sh
pnpm --filter @browser-recorder/cli dev     # run via tsx (no build step)
pnpm --filter @browser-recorder/cli build   # emit dist/ for the bin entry
pnpm --filter @browser-recorder/cli check   # typecheck
```

After building, you can run it via `node cli/dist/index.js` or link it globally:

```sh
cd cli && pnpm link --global
browser-recorder --help
```

## Generating screenshots

The README and `GUIDE.md` screenshots are produced from the built extension. `pnpm screenshots` builds Chrome MV3 and then runs [`scripts/capture-screenshots.mjs`](scripts/capture-screenshots.mjs) (Playwright), which writes:

- `docs/screenshots/` — README/guide crops
- `docs/store/` — 1280×800 store-listing images

If you change popup, options, or report-tab UI, regenerate the screenshots and commit them in the same PR.

To regenerate just the extension icons:

```sh
pnpm icons
```

## Versioning

- Use `./scripts/bump-version.sh patch` for bug fixes and small improvements.
- Use `./scripts/bump-version.sh minor` for significant new features.
- The `0.y.z` scheme is the current pre-stability phase. A real `1.0.0` is on the table once the feature set and APIs settle — see [AGENTS.md](AGENTS.md).

## Releasing

`./scripts/bump-and-push.sh <patch|minor|major|x.y.z>` bumps the version, tags it, and pushes the branch + tag. The pushed `v*` tag triggers the [Release workflow](.github/workflows/release.yml), which builds both zips and creates the GitHub release with them attached. It composes:

- [`scripts/bump-version.sh`](scripts/bump-version.sh) — version bump, commit, and tag

To build and release from your machine instead of via CI (or to re-upload assets to an existing release), run [`scripts/release.sh`](scripts/release.sh) directly — it builds both targets and creates/updates the GitHub release. The Release workflow runs the same build + release on a tag push.

For Chrome Web Store publishing details, see [PUBLISH.md](PUBLISH.md).
For Firefox/AMO, there's no scripted publish — `pnpm zip:firefox` produces the zip, and `scripts/release.sh` (or the Release workflow) attaches it to the GitHub release. Upload to AMO manually.

## Useful env files

- `.env.publish.example` — template for Chrome Web Store API credentials. Copy to `.env.publish` (gitignored) before running `./scripts/publish-chrome.sh`.

## Stack

- [WXT](https://wxt.dev) — extension framework (Chrome MV3 + Firefox MV3)
- [React 19](https://react.dev) + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com)
- [rrweb](https://github.com/rrweb-io/rrweb) — DOM snapshot serialisation
- [fflate](https://github.com/101arrowz/fflate) — in-browser ZIP
- [Playwright](https://playwright.dev) — CLI browser automation and screenshot capture
- [Biome](https://biomejs.dev) — linting
