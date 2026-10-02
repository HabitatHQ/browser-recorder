---
title: CLI
description: Capture browser events from the command line with the @browser-recorder/cli Node tool, via CDP attach or a Playwright script.
---

`@browser-recorder/cli` captures browser events from the command line and exports
a ZIP containing Markdown, metadata, and available capture artifacts. Its
capture and privacy capabilities are separate from the browser extension's.

- **`record`**—attach over Chrome DevTools Protocol (CDP) to a Chromium-based
  browser launched with remote debugging enabled; you drive it by hand.
- **`run`**—launch a fresh browser context and run a Playwright script.

Reports can contain sensitive data. Inspect and redact report contents before
sharing; see [What gets captured](#what-gets-captured).

## Install and run

The CLI is not published to npm. From the repository root, use Node.js
**22.18 or later in the 22.x line**, or a supported **24.11 or later** release,
and **pnpm 11.13.1** (matching CI). Install the workspace dependencies and Chromium:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

Run CLI commands from the repository root using its `tsx` development entry
point:

```sh
pnpm --filter @browser-recorder/cli dev --help
```

The TypeScript build is available with
`pnpm --filter @browser-recorder/cli build`, but the workspace does not provide
a supported standalone/global CLI install. Do not invoke `cli/dist/index.js`
as the CLI entry point.

## Quick start

### `record`—attach to a browser you launched

```sh
# Start a Chromium-based browser with remote debugging enabled.
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/browser-recorder-cdp

# In another terminal, from the repository root, attach and capture.
pnpm --filter @browser-recorder/cli dev record --port 9222 --output "$PWD/report.zip"

# Reproduce the issue, then press Ctrl+C to stop and export.
```

Use a dedicated, non-default browser profile for remote debugging; [Chrome 136+ ignores the debugging switch for the default profile](https://developer.chrome.com/blog/remote-debugging-port). The executable name/path differs by OS.

With multiple open pages, `record` prompts you to choose one. Metadata flags
do not skip that picker. If attaching to an already-loaded page, navigate or
reload it if you need interaction events: the interaction listener is
installed for subsequent document loads.

### `run`—drive a Playwright script

Create `steps.mjs` in the repository root:

```js
export default async function (page) {
  await page.goto("data:text/html,<button id='go'>Go</button>");
  await page.locator("#go").click();
};
```

Run it with absolute paths because the package script runs from the `cli/`
workspace directory:

```sh
pnpm --filter @browser-recorder/cli dev run \
  --script "$PWD/steps.mjs" --output "$PWD/report.zip"
```

The script must be an ES module with a default-exported function that
receives a Playwright `Page`; an async function is the usual form. Each run uses
a fresh browser context. This local example requires no external website.

## Commands

### `record`

Attach to a running Chromium-based browser over CDP.

| Flag | Description | Default |
|---|---|---|
| `-p, --port <port>` | Remote debugging port | `9222` |
| `-b, --browser <name>` | CDP browser hint; accepted values are `chromium`, `chrome`, `msedge` | `chromium` |
| `-o, --output <path>` | Output ZIP path | `./report.zip` (relative to `cli/`) |
| `-t, --title <title>` | Report title; skips only the title prompt | — |
| `-d, --description <desc>` | Report description; skips only the description prompt | — |
| `-n, --notes <notes>` | Report notes; skips only the notes prompt | — |

The browser option is a hint, not a browser selector. The default `chromium`
hint can attach to any Chromium-based browser started with
`--remote-debugging-port`; Firefox and WebKit do not support CDP attach. The
CLI help text mentions `brave` as a hint, but `record --browser brave` is not
accepted.

Metadata flags skip only their corresponding prompts. A multi-page picker, if
needed, still appears:

```sh
pnpm --filter @browser-recorder/cli dev record --port 9222 \
  --title "Login issue" --description "Unexpected result after submit" \
  --notes "Reproduced locally" --output "$PWD/report.zip"
```

### `run`

Launch a browser, execute an ES module script, and export captured data.

| Flag | Description | Default |
|---|---|---|
| `-s, --script <path>` | **Required.** ES module with a default-exported page function | — |
| `-b, --browser <name>` | `chromium`, `firefox`, `webkit`, `chrome`, or `msedge` | `chromium` |
| `-e, --executable <path>` | Path to a custom browser executable | — |
| `-o, --output <path>` | Output ZIP path | `./report.zip` (relative to `cli/`) |
| `-t, --title <title>` | Report title; skips only the title prompt | — |
| `-d, --description <desc>` | Report description; skips only the description prompt | — |
| `-n, --notes <notes>` | Report notes; skips only the notes prompt | — |
| `--headless` | Run browser in headless mode | `false` |

For Firefox, install its Playwright browser and pass an absolute script/output
path:

```sh
pnpm exec playwright install firefox
pnpm --filter @browser-recorder/cli dev run \
  --script "$PWD/steps.mjs" --browser firefox --output "$PWD/firefox-report.zip"
```

### Script and capture lifecycle

The CLI imports the script before calling its default function. Import errors
or a missing default function stop the command before report export. If the
loaded function throws, the error is logged and the CLI still tries to export
what it captured; this does not apply to import failures.

In `run`, capture listeners are attached before the script runs. Interactions
are collected from the document available at the end of the run; intermediate
documents are not flushed individually. A final screenshot and DOM snapshot
are attempted after the script completes.

## What gets captured

| Capture | Details |
|---|---|
| Console | `log`, `info`, `warn`, `error`, and `debug` messages, plus uncaught page errors observed while attached |
| Network | Responses observed while attached, with method, URL, status, timing, headers, and available request/response bodies; response bodies are truncated to 10,000 characters |
| Interactions | Best-effort click, input, submit, and `popstate` events from the active document; input values may be included (up to 200 characters) |
| Screenshot and DOM | One end-of-capture screenshot and DOM snapshot are attempted; either can be absent if capture fails |

**Current source-runner limitation:** the `tsx` development runner can introduce
an unavailable `__name` helper into the injected interaction listener. If
`console.json` contains `[uncaught] __name is not defined`, clicks and input
changes are not captured and `interactions.json` is absent. Console/network
capture and the final screenshot/DOM snapshot still run. Do not rely on CLI
interaction capture until this limitation is fixed.

Network data is response-based, not a record of every request. Requests
without an observed response, including failed requests, are not exported as
network events. Request bodies, raw request/response headers, and input values
can contain credentials or other sensitive information. The CLI does **not**
automatically sanitize these values or provide a review step. Inspect and
redact report contents yourself before sharing them.

The CLI does not capture WebSocket/SSE lifecycle events, annotated screenshots,
video, replay, performance summaries, or extension ring-buffer/background
capture. These are separate from the CLI's capabilities.

## Output

The output ZIP (default `./report.zip`, relative to `cli/` unless an absolute
path is used) can be extracted. Open its Markdown with a text/Markdown viewer
and its DOM snapshot with an HTML viewer; the ZIP itself is not a browser-based
report viewer.

| File | Contents |
|---|---|
| `README.md` | Included-file guide; always present |
| `report.md` | Human/agent-readable summary; always present |
| `metadata.json` | Session metadata; always present |
| `console.json` | Console events; included when non-empty |
| `network.json` | Observed network response events; included when non-empty |
| `interactions.json` | Interaction events; included when non-empty |
| `screenshot-1.png` | Final screenshot; included when capture succeeds |
| `dom-snapshot-end.html` | Final DOM snapshot; included when capture succeeds |

The CLI ZIP does not include `report.html`, merged `events.json`, video,
replay, or performance artifacts.

## Tips

- `record` captures until you press Ctrl+C.
- When multiple pages are open, `record` prompts you to choose one; metadata
  flags do not suppress this picker.
- For CI, use `--headless` and supply all three metadata flags and an absolute output path. For example, with the script above:

```sh
pnpm --filter @browser-recorder/cli dev run --headless \
  --script "$PWD/steps.mjs" --output "$PWD/report.zip" \
  --title "CLI capture" --description "" --notes ""
```
