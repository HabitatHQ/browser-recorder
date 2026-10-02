---
title: Development
description: Build, test, and ship the Browser Recorder extension or CLI from source.
---

Everything you need to build, test, and ship the extension or the CLI from source.

## Layout

The extension, CLI, and shared core form a three-package pnpm workspace:

| Path | Package | Purpose |
|---|---|---|
| `src/`, `public/`, `wxt.config.ts` | `browser-recorder` (root) | The browser extension (WXT + React 19) |
| `cli/` | `@browser-recorder/cli` | Node CLI that captures via Playwright/CDP |
| `packages/core` | `@browser-recorder/core` | Shared types + report builders used by both |

`site/` is a separate pnpm workspace containing the Astro/Starlight documentation site.

The capture engine in `src/capture-core/` is adapted from
[crikket](https://github.com/redpangilinan/crikket) by
[redpangilinan](https://github.com/redpangilinan) (AGPL-3.0, which is why this
whole project is AGPL-3.0). It has since been substantially extended, so it lives
in the main source tree rather than a `vendor/` directory — the attribution
stands because the original code remains its basis.

## Prerequisites

- Node 22.18+ on the 22.x line, or Node 24.11+ (the locked Babel toolchain excludes Node 20 and 23). CI uses Node 22.
- pnpm 11.13.1, matching CI. Avoid the broken 11.12.0 release.
- Chrome or another Chromium-based browser; Firefox 128+ for the Firefox build.

## Install

```sh
pnpm install --frozen-lockfile
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
pnpm test:mutation     # Stryker against deterministic policy cores
pnpm lint              # biome check src
```

To load the built extension:

- Chrome: open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select `.output/chrome-mv3/`.
- Firefox 128+: open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, select `manifest.json` inside `.output/firefox-mv3/`. (Temporary add-ons are removed on browser restart.)

## CLI (workspace package)

The CLI lives in `cli/` and is documented on the [CLI page](/browser-recorder/cli/). To work on it:

Run these commands from the repository root:

```sh
pnpm --filter @browser-recorder/cli dev --help  # run source via tsx
pnpm --filter @browser-recorder/cli check       # typecheck
pnpm exec playwright install chromium          # browser for CLI run and screenshots
```

Use `pnpm --filter @browser-recorder/cli dev <command> <flags>` for captures. The CLI is not published, and its current TypeScript build is not a standalone packaged binary: the shared core exports TypeScript source. Do not assume `node cli/dist/index.js` or a global link is a supported installation.

## Documentation site

Install and run the site independently:

```sh
pnpm --dir site install --frozen-lockfile
pnpm --dir site dev
pnpm --dir site build
pnpm --dir site preview
```

Keep the root guides and their copies in `site/src/content/docs/` synchronized. Site screenshots live in `site/src/assets/screenshots/` and must be refreshed alongside their counterparts in `docs/screenshots/` when the UI changes. The [Docs workflow](https://github.com/HabitatHQ/browser-recorder/blob/main/.github/workflows/docs.yml) deploys the site to GitHub Pages on changes under `site/`; changing only a root Markdown file does not update the published page.

## Verification

CI runs the root typecheck, lint, tests, and Chrome build. It does not run the CLI typecheck, Firefox build, or mutation tests; run those explicitly when affected. Mutation testing currently targets the network and dictation policy cores. Browser integration, recording permissions, and media capture still need browser smoke checks; unit tests alone do not establish browser compatibility.

If local worktrees live under `.worktrees/`, Vitest also discovers their duplicate
suites. Run `pnpm exec vitest run --exclude '.worktrees/**' --maxWorkers=2` to test
only this checkout with bounded concurrency.

## Generating screenshots

The README and guide screenshots are produced from the built extension. `pnpm
screenshots` builds Chrome MV3 and then runs `scripts/capture-screenshots.mjs`
(Playwright), which writes:

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
- The `0.y.z` scheme is the current pre-stability phase. A real `1.0.0` is on the table once the feature set and APIs settle. **The current bump script still rejects a non-zero major version**, including `major` and `1.0.0`; that guard must be changed when a stable release is approved.

## Releasing

`./scripts/bump-and-push.sh <patch|minor|0.y.z>` requires a clean working tree, invokes `bump-version.sh` to commit and tag, then pushes the branch and tag. **This is a publishing operation:** the pushed `v*` tag triggers the [Release workflow](https://github.com/HabitatHQ/browser-recorder/blob/main/.github/workflows/release.yml), which checks that the tag matches `package.json`, builds both browser ZIPs, and creates a GitHub release. A successful tagged release then triggers [Publish to Chrome Web Store](https://github.com/HabitatHQ/browser-recorder/blob/main/.github/workflows/publish-chrome.yml), which rebuilds the store ZIP, uploads it, and submits it for review. It is not a GitHub-only release.

The store workflow needs the four `CWS_*` repository secrets listed in [PUBLISH.md](https://github.com/HabitatHQ/browser-recorder/blob/main/PUBLISH.md). A manual dispatch defaults to submission; uncheck **publish** for draft-only upload. Pushing an ordinary documentation commit without a tag does not trigger these release/store workflows.

`scripts/release.sh` is a separate local build/upload helper, not an exact equivalent of the tag workflow. It currently switches GitHub authentication to a hard-coded account and overwrites matching assets on an existing release. Prefer the CI workflow; inspect and adapt the helper for your account before using it. It does not push a release tag or directly invoke the store workflow.

For Firefox/AMO, there's no scripted publish — `pnpm zip:firefox` produces the
zip, and `scripts/release.sh` (or the Release workflow) attaches it to the GitHub
release. Upload to AMO manually.

## Stack

- [WXT](https://wxt.dev) — extension framework (Chrome MV3 + Firefox MV3)
- [React 19](https://react.dev) + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com)
- [rrweb](https://github.com/rrweb-io/rrweb) — experimental DOM session recording and replay; one packaged local replay runtime is shared by preview and standalone export
- [fflate](https://github.com/101arrowz/fflate) — in-browser ZIP
- [Playwright](https://playwright.dev) — CLI browser automation and screenshot capture
- [Biome](https://biomejs.dev) — linting
