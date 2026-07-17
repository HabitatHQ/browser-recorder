# Request replay

Status: implemented (M1–M3); live E2E partially verified (see §10) · Owner: —

## 1. Motivation

Inspired by [rep+ (`repplus/rep-chrome`)](https://github.com/repplus/rep-chrome), a Burp-style
HTTP *repeater* living in a DevTools panel: capture every request, then edit method/headers/body
and resend, with attack modes, extractors, and AI on top.

We are **not** building a pentest repeater. We are a bug-report bundler. The slice of rep+ that
serves *our* mission — "does the bug still reproduce if I tweak this request?" — is a lightweight
**edit-and-resend with a response diff**, plus a **copy-as-curl** scaffold on every captured
request. Attack modes, extractors, and AI are explicit non-goals (§8).

## 2. Corrected technical premise

An earlier framing assumed we already hold `chrome.debugger`/CDP and could replay via
`Fetch.continueRequest`. **That is false.** This repo uses no `chrome.debugger` and no CDP. The
`src/capture-core/debugger/**` tree is a homegrown *in-page monkey-patch* engine: it wraps
`window.fetch`/`XMLHttpRequest` in the MAIN world, injected via `chrome.scripting.executeScript`.
Capture is purely **observational** — it cannot pause, rewrite, or originate a request.

What we *do* already have, and can build on:

- `host_permissions: ["<all_urls>"]` is already granted (`wxt.config.ts`).
- MAIN-world script injection into the target tab is already wired
  (`src/lib/bug-report-debugger/engine/background/injection.ts`).
- A typed background↔UI messaging envelope (`src/lib/messaging.ts`: `sendToBackground`, `ok`, `fail`).

This makes replay *cheaper* than the CDP route, with **zero new permissions** for the recommended
path (§5).

## 3. The hard constraint: captured entries are lossy

Captured network entries are **not** a faithful source for an exact replay. At capture and
normalize time we deliberately:

- **Drop sensitive headers** — `Cookie`, `Authorization`, etc. via `shouldHideHeader`
  (`engine/page/utils.ts`).
- **Truncate** every header value (500 chars), header name (120), URL (4096), and request/response
  body to ~4000 chars (`MAX_BODY_LENGTH`, `MAX_NETWORK_BODY_LENGTH`; `truncate` appends `"..."`).
- **Redact** secret-looking query params and JSON/form body fields to `[REDACTED]`.

The stored shape (`DebuggerNetworkEvent`, `packages/core/src/types.ts`):

```ts
interface DebuggerNetworkEvent {
  kind: "network"; timestamp: number;
  method: string; url: string; status?: number; duration?: number;
  requestHeaders?: Record<string,string>; responseHeaders?: Record<string,string>;
  requestBody?: string; responseBody?: string;
  dropped?: boolean; // injected by export-review, not by capture
}
```

**Implications that drive the design:**

1. Copy-as-curl (tier 1) produces a **scaffold**, not a runnable command: auth headers are absent
   and long bodies are truncated. The UI must say so. It is still useful — the common case is a
   GET whose auth rides on cookies, or a request the user completes by hand.
2. Live replay (tier 2) must **not** try to reconstruct auth from the capture. Instead it sends
   from the live tab origin with `credentials: "include"`, so the browser attaches the *real*
   cookie jar automatically. The user edits the request text (URL/method/headers/body) before
   sending and can paste back anything that was truncated/redacted.
3. We never store or export raw un-redacted secrets to make replay "faithful" — that would fight
   the redaction-first design. (A non-default "capture full request for replay" toggle is possible
   but out of scope; §8.)

## 4. Tiers (agreed scope: both tier 1 and tier 2; skip tier 3)

| Tier | What | Where | New perms |
|------|------|-------|-----------|
| 1 | Copy-as-curl / fetch scaffold on each request | exported `report.html` **and** live review UI | none |
| 2 | Edit + resend + response-diff (ephemeral) | live tab only | none (recommended path) |
| 3 | Attack modes, extractors, AI | — | rejected (§8) |

## 5. Send-path decision (tier 2)

| Option | Mechanism | Cookies/origin | Cross-origin | New perms | Verdict |
|--------|-----------|----------------|--------------|-----------|---------|
| **A. In-page fetch** (recommended) | `chrome.scripting.executeScript({world:"MAIN"})` runs an async `fetch` in the page and returns `{status,headers,body,durationMs}` | real, automatic (`credentials:"include"`) | subject to page CORS | **none** | ✅ primary |
| B. Background fetch + DNR | SW `fetch` (bypasses CORS via host perms) + `declarativeNetRequest` `modifyHeaders` to inject forbidden headers | needs DNR rules to override; `credentials:"include"` gives real cookies | works | `declarativeNetRequest` | escalation only |
| C. `chrome.debugger` + CDP `Fetch` | attach CDP client, `Fetch.continueRequest` | faithful | works | `debugger` + new CDP layer + debugging banner + conflicts with injection | ❌ rejected |

**Recommendation: A.** The dominant bug-repro case is replaying the page's *own* API call
(same-origin), where in-page fetch is exact and free. `credentials:"include"` supplies real auth.
Cross-origin replay returns a CORS-filtered/opaque response — document it as a known limit rather
than reach for B. Reserve B for a later "cross-origin / header-override" mode if demand appears;
that is the boundary toward becoming a general repeater (tier 3).

### Replay primitive (A), sketch

`executeScript` with a MAIN-world async function that:
1. builds `fetch(url, { method, headers, body, credentials:"include", redirect:"manual" })`,
2. times it, reads the response text (size-capped), collects response headers,
3. returns a plain serializable `ReplayResult`.

Wrapped by a background handler (new `BgMessage` variant, e.g. `replayRequest`) invoked from the UI
via `sendToBackground`. One-shot request/response; no persistent channel needed.

## 6. Response diff (free win)

We already store the original `responseBody`/`responseHeaders`/`status` on the captured entry, so
the tier-2 panel diffs **edited-replay response vs captured original** with no extra capture work.
Reuse a text diff (rep+ renders a line diff; we can start with a simple status/headers/body diff).

## 7. Privacy / redaction interaction

- **Replay reads live, un-redacted data** (that is the point — real cookies, user-completed body).
- **Replay results are ephemeral UI state**: never appended to `debuggerEvents`, never persisted to
  `chrome.storage`/OPFS, never written into the export zip. This sidesteps the redaction pipeline
  entirely — there is nothing new to scrub because nothing new is retained.
- Copy-as-curl operates on the **already-redacted/edited** captured entry in the export flow, so it
  can never leak more than the report itself already would.
- **Known edge:** after a session stops, `resumeRingAfterSession()` may re-arm the always-on ring on
  the recorded tab, so a replayed request can be captured into a *later* ring export (it passes
  through the ring's own capture-time redaction). It never enters the current report's zip. Suppress
  only if this proves surprising.

## 8. Non-goals

- Attack/fuzzing modes (Sniper/Battering Ram/Pitchfork/Cluster Bomb).
- Secret/endpoint/param extractors and rule packs.
- AI request explanation / attack-vector suggestions.
- `chrome.debugger`/CDP integration.
- A "capture full un-redacted request for faithful replay" toggle (revisit only if in-page + user
  edit proves insufficient in practice).

## 9. Milestones (TDD; atomic commits, each green on its own)

**M1 — Copy-as-curl scaffold (tier 1). — DONE (`86e721e`)**
- `packages/core/src/curl.ts`: pure `toCurl(ev: DebuggerNetworkEvent): string` (and maybe
  `toFetch`). Handles method, headers, body quoting/escaping, truncation marker note. Export from
  `packages/core/src/index.ts`. Red/green unit tests in `packages/core` (quoting, no-body GET,
  header ordering, truncated-body annotation).
- Wire into live review UI: a copy button per row in `NetworkPrivacyReview`
  (`src/components/export-review.tsx`, `events.map` header row) using `navigator.clipboard`.
- Wire into exported report: inline a `toCurl` twin + a delegated click handler + button markup +
  style into the report string (`src/lib/report-html.ts` `summarize`/`netDetail`/map loop/`<style>`).
  The report viewer is a raw self-contained string with no imports, so the function body is inlined
  there (kept in sync with the core version; covered by `report-html.test.ts`).

**M2 — Replay primitive (tier 2 plumbing). — DONE (`21faf69`)**
- Pure request-builder: normalize a (possibly user-edited) request into `fetch` args; unit-tested.
- MAIN-world replay function + background `replayRequest` message handler + `sendToBackground`
  wrapper. `ReplayResult` type in `packages/core`. Tests around request-building and result-shaping
  (mock `executeScript`).

**M3 — Replay UI (tier 2 UX). — DONE (`1189626`)**
- A replay panel/drawer: prefilled from the selected captured request, editable
  URL/method/headers/body, "Send", response view, and diff vs captured original. Ephemeral state
  only. Same-origin happy path + CORS-limit messaging + error states.

## 10. Verification

Per milestone: `pnpm test` (vitest) green; typecheck/biome clean; then drive the real extension
(`/run`) — capture a session on a same-origin API, copy-as-curl and confirm the scaffold, then
edit-and-resend and confirm the response + diff render and that nothing replayed leaks into the
exported zip.

### Live E2E results

- **Copy-as-curl (report):** verified in-browser. The button on each network row flips
  `curl → copied` on click and writes a `curl '<url>' -H '…'` scaffold to the clipboard.
- **Replay primitive (`replayInPage`):** verified in-browser against live endpoints — same-origin
  GET (200/JSON), POST-with-body (`sendsBody` branch), and cross-origin (→ `error`/"Failed to
  fetch", which drives the panel's CORS note). The background `replay-request` handler returns the
  result only and never touches the session, so a replay cannot reach `debuggerEvents` or the zip
  by construction.
- **Not yet driven:** the review-panel UI *rendering* — `(was NNN)` status-diff badge, response
  header/body collapsibles, original-body pane — and an actual zip export. The browser-automation
  tooling used could not reach `chrome-extension://` review tabs; the underlying logic and unit
  tests pass. Confirm by hand when convenient.
