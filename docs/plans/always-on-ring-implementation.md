# Always-on ring: implementation plan

Implements `always-on-ring-refinement.md` (the product spec). This doc is the
engineering breakdown—data model, module boundaries, and the commit sequence.
Each commit builds green on its own.

## Canonical terms

- **Scope** — the domain rules: `mode` (`allowlist` | `blocklist` | `all`) plus
  `allow` and `block` hostname-pattern lists. Persistent (options).
- **Pin** — a session-scoped hostname the user opts into from the popup. Overrides
  the allowlist; never overrides a block. Cleared on browser restart.
- **Eligibility** — the pure decision "may this URL be recorded right now?",
  yielding a machine reason used for the popup's explanation text.
- **Recording tab** — the single tab whose data streams in right now (the focused,
  eligible one). Only one at a time.
- **Retained buffer** — a switched-away tab's already-captured data, kept and
  merged into the export until it ages out of the rolling window.

## Data model

`RingScopeMode = "allowlist" | "blocklist" | "all"`

```
RingScopeConfig { mode: RingScopeMode; allow: string[]; block: string[] }
RingConfig { enabled; dataDurationSec; videoDurationSec; scope: RingScopeConfig }
```

Pins: `string[]` of hostnames in `chrome.storage.session` (key `ringPins`)—session
storage is cleared on browser restart, which is exactly the pin lifetime, and it
survives a service-worker suspend.

## Pure core — `src/lib/ring/scope.ts` (Commit 1)

Unit-tested, no chrome APIs. Functions:

- `hostFromUrl(url): string | null`
- `isBrowserInternal(url): boolean` — `chrome:`, `about:`, `edge:`, extension
  pages, `chrome-untrusted:`, `devtools:`, `view-source:`, empty/`newtab`.
- `hostMatchesPattern(host, pattern): boolean` — case-insensitive; `*` → `.*`,
  other chars literal, whole-string anchored. So `*.example.com` matches any
  subdomain but not the bare apex; `example.com` matches only itself.
- `hostMatchesAny(host, patterns): boolean`
- `evaluateRingScope(url, scope, pins): RingEligibility`

Precedence (block always wins):
1. internal → `{recordable:false, reason:"internal"}`
2. matches `block` → `{false, "blocked"}`
3. matches a pin → `{true, "pinned"}`
4. mode `all` → `{true, "all-mode"}`
5. mode `blocklist` → `{true, "blocklist-mode"}`
6. mode `allowlist`: empty allow → `{false, "empty-allowlist"}`;
   matches allow → `{true, "allowed"}`; else → `{false, "not-in-allowlist"}`.

Pins match by exact hostname equality (a pin is a concrete host taken from a tab).

## Storage (Commit 2)

- `getRingConfig` merges `DEFAULT_RING_CONFIG` (and nested `DEFAULT_RING_SCOPE`)
  so pre-existing stored configs gain `scope`.
- `getRingPins()/setRingPins()/addRingPin()/removeRingPin()` on session storage.

## Background: gating (Commit 3)

- `startRingOnTab`/`rotateRingToTab` consult `evaluateRingScope` before recording;
  ineligible → no capture, status carries the reason.
- `onUpdated` (URL change) re-evaluates the recording tab; navigating to a
  blocked/out-of-scope URL stops capture immediately (drop nothing from the buffer
  that's already there, but stop adding).
- First enable with an empty allowlist auto-pins the current site.
- New messages: `pin-site`, `unpin-site`, `get-ring-tabs`, `save-ring-scope`.

## Background: multi-tab retention + merged export (Commit 4)

- Replace the four global event arrays with `Map<tabId, RingTabBuffer>`; video
  stays single (current recording tab only).
- Rotate keeps the old buffer; cap `MAX_RETAINED_TABS` (8), evicting the
  oldest-`lastActiveMs` non-pinned buffer.
- Export merges every buffer's events into the flat snapshot arrays. Each event is
  tagged `ringSource: {tabId, title, host}` when >1 tab contributed; the report
  orders by event timestamp. Single-tab export is unlabeled.

## UI

- Popup (Commit 5): tab list with state (`REC` / in scope / blocked / pinned) and
  pin toggles; reason-aware status text instead of a bare "Buffering…".
- Options (Commit 6): scope mode radio + allow/block textareas.

## Trust + session interaction (Commit 7)

- Toolbar badge tint while a tab actively records (distinct from `REC`).
- Explicit session start pauses the ring; ends resume it (single video stream).

## Success criteria — see product spec. Verified by unit tests for the pure core
and manual/e2e for the wired behavior.
