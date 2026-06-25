# Publishing

This covers what store reviewers need (permissions, source review) and how to ship a build. Read the permissions and review notes first — they're what actually gets submissions rejected. The mechanical upload steps are in the [appendix](#appendix-build--upload-steps).

## Permission justifications

Both the Chrome Web Store and AMO ask *why* each permission is requested, and a broad set on a capture tool draws scrutiny. Paste these into the dashboard's per-permission justification fields. Permissions are declared in `wxt.config.ts`.

| Permission | Why it's needed |
|---|---|
| `activeTab` | Capture data from the tab the user explicitly records — scoped to user action. |
| `scripting` | Inject the capture interceptors (console/network/interaction hooks, DOM serialiser) into the page. |
| `storage` | Persist settings and buffer in-progress session/ring data locally. Nothing is sent anywhere. |
| `tabs` | Follow tab switches so the ring buffer tracks the active tab, and open the report tab on stop. |
| `management` | Read the list of installed extensions, recorded into `metadata.json` so bug reports note what else was running. |
| `tabCapture` *(Chrome only)* | Record tab video via `MediaRecorder`. |
| `offscreen` *(Chrome only)* | Host the offscreen document that runs `MediaRecorder` for video. |
| `<all_urls>` (host) | Debug capture must work on whatever site the user is reproducing a bug on; the extension only activates on tabs the user records. |

The strongest review asset is the privacy story: **no data leaves the device** — no server, no account, no network calls. Make sure the privacy-policy URL and description say this plainly.

## Source-code review (AMO)

Mozilla reviews source whenever submitted code is minified or bundled, which WXT output always is. To avoid a back-and-forth rejection, give the reviewer:

- **Repo:** this project, AGPL-3.0.
- **Build steps:** `pnpm install` then `pnpm zip:firefox`; the output zip in `.output/` matches the submitted package.
- **Toolchain:** Node and pnpm versions (match the repo's `package.json` / lockfile).
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

### Chrome Web Store

The package upload is scripted; the store **listing** (screenshots, descriptions, promo images) is not — see [above](#whats-in-the-upload-vs-the-dashboard).

```sh
pnpm build:cws          # build .output/<name>-<version>-chrome-cws.zip (manifest key stripped)
pnpm publish:chrome     # upload as a draft
pnpm publish:chrome --publish   # upload and submit for review
```

One-time setup:

1. Register a [Chrome Web Store developer account](https://chrome.google.com/webstore/devconsole) and upload the first version **manually** (the API can only update an existing item). Note the **extension ID**.
2. In [Google Cloud Console](https://console.cloud.google.com): create a project, enable the **Chrome Web Store API**, and create an **OAuth 2.0 Desktop client** (client ID + secret).
3. Mint a refresh token once (e.g. `npx chrome-webstore-upload-keys`).
4. `cp .env.publish.example .env.publish` and fill in the four `CWS_*` values. `.env.publish` is gitignored.

Why a separate build: the `key` in `wxt.config.ts` pins a stable extension ID for local unpacked loads, but the store assigns its own key — a baked-in `key` makes uploads fail. `build:cws` sets `CWS_BUILD=1` to strip it.

### Firefox (AMO)

There's no scripted AMO publish. `pnpm zip:firefox` produces a Firefox-flavoured zip in `.output/`, and `scripts/release.sh` attaches it (alongside the Chrome zip) to the GitHub release. To list on [addons.mozilla.org](https://addons.mozilla.org), upload that zip manually through the AMO Developer Hub, and be ready with the [source-review](#source-code-review-amo) details above.
