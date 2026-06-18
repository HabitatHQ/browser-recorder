# @browser-recorder/cli

Capture browser events from the command line and export a self-contained `.zip` report.

Two modes:

- **`record`** — attach to a browser you launch yourself (Chrome, Edge, Brave, Arc, …) via the Chrome DevTools Protocol. Use this when you want to drive a real browser session by hand.
- **`run`** — let the CLI launch a browser and drive it with a Playwright script. Use this for CI, regression captures, or scripted bug repros.

Both modes produce the same `.zip` shape, which can be opened in any browser (see [Output](#output)).

## Install

The package is not published to npm yet. From a clone of this repo:

```sh
pnpm install
pnpm --filter @browser-recorder/cli build
```

Then run it directly:

```sh
node cli/dist/index.js --help
```

Or link it for use anywhere on your machine:

```sh
cd cli && pnpm link --global
browser-recorder --help
```

## Quick start

### `record` — attach to a browser you launched

```sh
# 1. Launch your browser with the remote debugging port open.
google-chrome --remote-debugging-port=9222

# 2. In another terminal, attach and start capturing.
browser-recorder record --port 9222 --output ./report.zip

# 3. Reproduce the bug. Press Ctrl+C when done.
# 4. Answer the prompts (title, description, notes) — or pass --title/--description/--notes to skip.
```

If multiple tabs are open, you'll be prompted to pick one.

### `run` — drive a Playwright script

```sh
cat > steps.js <<'EOF'
export default async function (page) {
  await page.goto("https://example.com");
  await page.getByRole("link", { name: "More information" }).click();
};
EOF

browser-recorder run --script ./steps.js --output ./report.zip
```

The script must have a **default export** that receives a `playwright.Page` and returns a `Promise`.

## Commands

### `browser-recorder record`

Attach to a running Chromium-based browser via CDP and capture events.

| Flag | Description | Default |
|---|---|---|
| `-p, --port <port>` | Remote debugging port | `9222` |
| `-b, --browser <name>` | Browser hint for error messages: `chromium`, `chrome`, `msedge`, `brave` | `chromium` |
| `-o, --output <path>` | Output zip path | `./report.zip` |
| `-t, --title <title>` | Report title (skips prompt) | — |
| `-d, --description <desc>` | Report description (skips prompt) | — |
| `-n, --notes <notes>` | Report notes (skips prompt) | — |

**Supported browsers:** any Chromium-based browser launched with `--remote-debugging-port`. Firefox and WebKit do not support CDP attach — use `run` for those.

**Non-interactive mode:** pass `-t`, `-d`, and `-n` to skip the post-capture prompts (useful in CI):

```sh
browser-recorder record --port 9222 --title "Login broken" --description "500 on POST /login" --notes "See steps" --output ./report.zip
```

### `browser-recorder run`

Launch a browser, run a Playwright script, and export events.

| Flag | Description | Default |
|---|---|---|
| `-s, --script <path>` | **Required.** Path to the script to run | — |
| `-b, --browser <name>` | `chromium`, `firefox`, `webkit`, `chrome`, `msedge` | `chromium` |
| `-e, --executable <path>` | Path to a custom browser executable (Brave, Arc, …) | — |
| `-o, --output <path>` | Output zip path | `./report.zip` |
| `-t, --title <title>` | Report title (skips prompt) | — |
| `-d, --description <desc>` | Report description (skips prompt) | — |
| `-n, --notes <notes>` | Report notes (skips prompt) | — |
| `--headless` | Run browser in headless mode | `false` |

**Example with a specific browser:**

```sh
browser-recorder run --script ./steps.js --browser firefox --output ./firefox-report.zip
```

**Example with a custom executable (Brave on macOS):**

```sh
browser-recorder run --script ./steps.js \
  --browser chromium \
  --executable "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  --output ./report.zip
```

## What gets captured

For both modes, the CLI captures the same three channels as the extension:

| Channel | Notes |
|---|---|
| Console | `log`, `info`, `warn`, `error`, `debug`, plus uncaught page errors |
| Network | All XHR / fetch requests and responses (request/response body and headers) |
| Interactions | Clicks, inputs, navigations — recorded as the script (or the user) drives the page |

A single end-of-capture screenshot and DOM snapshot are also included.

**Not captured by the CLI** (the browser extension captures these; the CLI does not):

- WebSocket and SSE lifecycle events
- Screenshots with annotation (the CLI's screenshot is a raw PNG)
- Video / tab recording
- Ring-buffer / background capture

If you need those, use the [browser extension](../README.md).

## Output

A self-contained `.zip` (default `./report.zip`) containing:

| File | Contents |
|---|---|
| `report.md` | Human/agent-readable summary |
| `metadata.json` | Session info (title, url, timestamp, duration) |
| `console.json` | Console events |
| `network.json` | Network requests |
| `interactions.json` | User interactions |
| `dom-snapshot-*.html` | DOM snapshot(s) |
| `screenshot-*.png` | End-of-capture screenshot |

The CLI output is intentionally lighter than the extension's (no `report.html` viewer, no merged `events.json`, no video). For the full artifact set, use the extension.

## Tips

- **`record` will hang forever if you forget to press Ctrl+C.** That's by design — the capture is open-ended until you stop it. If you want a fixed-length capture, use `run` with a script.
- **Multi-tab `record`:** the CLI picks tab 0 by default; if you have more than one, you'll get a picker. Close other tabs first to skip the prompt.
- **Errors during a `run` script do not abort the capture.** The script's error is logged, but the CLI still exports whatever was captured up to that point. This is usually what you want for a bug repro.
- **CI usage:** pass `--headless`, all three `-t/-d/-n` flags, and an explicit `--output` so the command never blocks on a prompt.

## Related

- [Browser extension README](../README.md)
- [User guide](../GUIDE.md) — covers the extension; the CLI captures a strict subset of those channels
