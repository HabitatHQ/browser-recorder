# Publishing

This covers what store reviewers need (permissions, source review) and how to ship a build. Read the permissions and review notes first — they're what actually gets submissions rejected. The mechanical upload steps are in the [appendix](#appendix-build--upload-steps).

## Permission justifications

Both the Chrome Web Store and AMO ask *why* each permission is requested, and a broad set on a capture tool draws scrutiny. Paste these into the dashboard's per-permission justification fields. Permissions are declared in `wxt.config.ts`.

| Permission | Why it's needed |
|---|---|
| `activeTab` | Capture data from the tab the user explicitly records — scoped to user action. |
| `scripting` | Inject the capture interceptors (console/network/interaction hooks, DOM serialiser) into the page. |
| `storage` | Persist settings, recovery metadata, and session/ring state locally; captured artifacts also use OPFS. |
| `tabs` | Follow eligible focused tabs for scoped ring capture, and open the report tab on stop. |
| `management` | Read the list of installed extensions, recorded into `metadata.json` so bug reports note what else was running. |
| `tabCapture` *(Chrome only)* | Record tab video via `MediaRecorder`. |
| `offscreen` *(Chrome only)* | Host the offscreen document that runs `MediaRecorder` for video. |
| `<all_urls>` (host) | Required broad host access for capture hooks and user-triggered request replay. Capture is limited by the active session or enabled ring scope; this is not merely temporary `activeTab` access. |

These permissions are required, not optional. Chrome requests `tabCapture` and `offscreen`; Firefox omits them and uses a dedicated capture tab with a `getDisplayMedia` picker for session video. Firefox builds require version 128 or newer.

Describe the privacy model accurately in the listing and reviewer notes: **local diagnostic capture, no automatic telemetry or report-upload backend, and user-controlled exports**. Request replay is an explicit network action that sends the edited request with the page's live credentials and can modify server data. Automatic redaction is limited; screenshots, video, DOM, and experimental replay may contain sensitive content. Dictation is available only with browser-supported on-device processing, with no remote recognition fallback. Keep the listing consistent with [PRIVACY.md](PRIVACY.md), including retention and sharing caveats, rather than promising “no network calls” or universal sanitization.

## Source-code review (AMO)

Mozilla reviews source whenever submitted code is minified or bundled, which WXT output always is. To avoid a back-and-forth rejection, give the reviewer:

- **Repo:** this project, AGPL-3.0.
- **Build steps:** `pnpm install --frozen-lockfile` then `pnpm zip:firefox`; provide the exact submitted version and its source.
- **Toolchain:** Node 22.18+ on the 22.x line or Node 24.11+, and pnpm 11.13.1, matching [DEVELOPMENT.md](DEVELOPMENT.md) and CI.
- **Adapted code:** the capture engine in `src/capture-core/` is adapted from [crikket](https://github.com/redpangilinan/crikket) (also AGPL-3.0), since extended in-tree.

## What's in the upload vs. the dashboard

The uploaded zip contains **only the extension code + manifest**. The store APIs handle the package and publish state — **nothing else**. There is no public API for listing assets, so these are managed by hand in the Developer Dashboard:

- **Detailed description** — separate from the manifest `description`; edited in the dashboard.
- **Screenshots** — 1–5 images, **1280×800** or 640×400 PNG/JPEG. `pnpm screenshots` writes store-ready 1280×800 versions to `docs/store/`: submit **popup**, **annotation**, and **recorder** (drag them into the dashboard). The Settings page is too long to stay legible at 1280×800, so it's captured for the README/guide only — not the store. The `docs/screenshots/` PNGs are the tighter doc crops.
- **Promo tiles** — small 440×280, optional marquee 1400×560.
- **Store icon** — the 128×128 icon from the manifest is reused.
- **Category, language, privacy policy URL** — dashboard fields.

So: code ships through the upload scripts; copy and imagery are a manual dashboard step that only changes when you want to refresh the listing.

---

## Appendix: build & upload steps

### Automated releases and store submission

Pushing a `v*` tag triggers the GitHub Release workflow. Once that workflow succeeds for a version tag, `publish-chrome.yml` checks out the released commit, builds the key-free store ZIP, uploads it, and **automatically submits it for review**. This is not a draft-only upload. The tag must match the version in `package.json`.

Configure these repository Actions secrets before using the automated path: `CWS_EXTENSION_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, and `CWS_REFRESH_TOKEN`. Do not put credentials in source control or documentation.

You can also manually dispatch **Publish to Chrome Web Store** on a selected ref. Its **publish** input defaults to true; uncheck it to upload only a draft. Store approval controls when a submitted version becomes public. Ordinary branch pushes without a release tag do not invoke this pipeline.


### Chrome Web Store

The package upload is scripted; the store **listing** (screenshots, descriptions, promo images) is not — see [above](#whats-in-the-upload-vs-the-dashboard).

```sh
pnpm build:cws          # build .output/<name>-<version>-chrome-cws.zip (manifest key stripped)
pnpm publish:chrome     # local upload as a draft
pnpm publish:chrome --publish   # local upload and submit for review
```

One-time setup:

1. Register a [Chrome Web Store developer account](https://chrome.google.com/webstore/devconsole) and upload the first version **manually** (the API can only update an existing item). Note the **extension ID**.
2. In [Google Cloud Console](https://console.cloud.google.com): create a project, enable the **Chrome Web Store API**, and create an **OAuth 2.0 Desktop client** (client ID + secret).
3. With `CWS_CLIENT_ID` and `CWS_CLIENT_SECRET` in your environment, run `node scripts/mint-cws-token.mjs` for the local OAuth loopback flow; sign in as the listing owner and securely store the returned refresh token. This helper uses macOS `open` to launch the browser; on another OS, open its printed consent URL manually.
4. Copy `.env.publish.example` to `.env.publish` (gitignored) and fill in the four `CWS_*` values, or supply them through the environment. `CWS_ENV_FILE` selects an alternate local env file. For CI, add the same values as repository Actions secrets.

Why a separate build: the `key` in `wxt.config.ts` pins a stable extension ID for local unpacked loads, but the store assigns its own key — a baked-in `key` makes uploads fail. `build:cws` sets `CWS_BUILD=1` to strip it.

`build:cws` replaces `.output/chrome-mv3/` with the key-free store build; run `pnpm build` again before reloading a stable-ID unpacked build. The local upload script reuses a version-matching ZIP if it exists, so rebuild explicitly after changing code. Listing copy and screenshots still require manual dashboard updates regardless of whether upload is local or automated.

### Firefox (AMO)

There's no scripted AMO publish. `pnpm zip:firefox` produces a Firefox-flavoured ZIP in `.output/`, and the tagged Release workflow attaches it alongside the Chrome ZIP. Upload that ZIP manually through the [AMO Developer Hub](https://addons.mozilla.org), with the [source-review](#source-code-review-amo) details above. The local `scripts/release.sh` helper can upload GitHub assets but has account-specific assumptions—see [DEVELOPMENT.md](DEVELOPMENT.md#releasing) before using it.
