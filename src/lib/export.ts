import type { ScreenshotEntry, Session, SessionCounts, SubmitFormValues } from "@/lib/types";
import { Zip, ZipPassThrough } from "fflate";

const README = `\
# Bug report — chrome-recorder

Captured with [chrome-recorder](https://github.com/npalladium/chrome-recorder).

## Files

| File | Contents |
|---|---|
| metadata.json | Session info: URL, duration, browser, OS, viewport, device pixel ratio, color scheme, network type, installed extensions, active service workers |
| console.json | Console events (log / info / warn / error / debug) captured during the session. Entries prefixed \`[uncaught]\` are unhandled JS exceptions; \`[unhandled rejection]\` are unhandled promise rejections. |
| network.json | XHR and fetch requests: URL, method, status, headers, body (truncated at 10 kB), timing |
| interactions.json | User interactions: clicks, inputs, navigations, scrolls with CSS selector paths |
| dom-snapshot-start.html | Page HTML captured at session start. Open in a browser — relative URLs resolve via \`<base href>\`. Cross-origin stylesheets are not inlined (CORS). |
| dom-snapshot-N.html | On-demand DOM snapshots taken during the session |
| screenshot-N.png | Screenshots taken during the session (annotations rasterised in) |
| video.webm | Tab recording (if enabled) |
| notes.md | Free-form notes entered before export |

## Notes

- **Browser-native console entries** (e.g. \`ERR_BLOCKED_BY_CLIENT\`, preload warnings) are not present in console.json — they are injected into DevTools directly by Chrome and do not go through the JS \`console\` API.
- Console and network capture only covers events that occurred **after the session was started**.
- Sensitive headers (\`Authorization\`, \`Cookie\`) are redacted to \`[REDACTED]\` by default.
`;

export interface ExportInput {
  session: Session | null;
  counts: SessionCounts;
  formValues: SubmitFormValues;
  screenshots: ScreenshotEntry[];
  domSnapshots: Record<string, string>;
  debuggerEvents: {
    console: unknown[];
    network: unknown[];
    interactions: unknown[];
  };
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

function toFilenameTimestamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/, "");
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function addText(zip: Zip, name: string, text: string): void {
  const f = new ZipPassThrough(name);
  zip.add(f);
  f.push(encode(text), true);
}

async function addBlob(zip: Zip, name: string, blob: Blob): Promise<void> {
  const buf = await blob.arrayBuffer();
  const f = new ZipPassThrough(name);
  zip.add(f);
  f.push(new Uint8Array(buf), true);
}

export async function exportReportAsZip(input: ExportInput): Promise<string> {
  const { session, formValues, screenshots, domSnapshots, debuggerEvents } = input;

  let extensions: Array<{ name: string; version: string; enabled: boolean }> = [];
  try {
    const all = await chrome.management.getAll();
    extensions = all
      .filter((ext) => ext.type !== "theme" && ext.id !== chrome.runtime.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, version, enabled }) => ({ name, version, enabled }));
  } catch {
    // management API unavailable
  }

  let serviceWorkers: Array<{ scope: string; scriptUrl: string; state: string }> = [];
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      serviceWorkers = regs.map((reg) => ({
        scope: reg.scope,
        scriptUrl:
          reg.active?.scriptURL ??
          reg.installing?.scriptURL ??
          reg.waiting?.scriptURL ??
          "",
        state: reg.active
          ? "active"
          : reg.installing
            ? "installing"
            : reg.waiting
              ? "waiting"
              : "unknown",
      }));
    }
  } catch {
    // serviceWorker API unavailable
  }

  const now = new Date();
  const rawSlug =
    formValues.title && formValues.title !== "Bug report"
      ? formValues.title
      : session?.tabUrl
        ? (() => { try { return new URL(session.tabUrl).hostname; } catch { return ""; } })()
        : "";
  const slug = slugify(rawSlug);
  const filename = `bug-report${slug ? `-${slug}` : ""}-${toFilenameTimestamp(now)}.zip`;

  const metadata = {
    title: formValues.title,
    description: formValues.description,
    url: session?.tabUrl ?? null,
    pageTitle: session?.tabTitle ?? null,
    timestamp: now.toISOString(),
    sessionDurationMs: session ? now.getTime() - session.startedAt : null,
    captureConfig: session?.captureConfig ?? null,
    deviceInfo: {
      browser: navigator.userAgent,
      os: navigator.platform,
      viewport: { width: window.screen.width, height: window.screen.height },
      devicePixelRatio: window.devicePixelRatio,
      touch: navigator.maxTouchPoints > 0,
      colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      connectionEffectiveType:
        (navigator as Navigator & { connection?: { effectiveType?: string } }).connection
          ?.effectiveType ?? null,
    },
    extensions,
    serviceWorkers,
  };

  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];

    const zip = new Zip((err, chunk, final) => {
      if (err) {
        reject(err);
        return;
      }
      chunks.push(chunk);
      if (final) {
        const blob = new Blob(chunks as BlobPart[], { type: "application/zip" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        resolve(filename);
      }
    });

    const work: Array<() => Promise<void>> = [];

    addText(zip, "README.md", README);
    addText(zip, "metadata.json", JSON.stringify(metadata, null, 2));

    if (debuggerEvents.console.length > 0) {
      addText(zip, "console.json", JSON.stringify(debuggerEvents.console, null, 2));
    }

    if (debuggerEvents.network.length > 0) {
      addText(zip, "network.json", JSON.stringify(debuggerEvents.network, null, 2));
    }

    if (debuggerEvents.interactions.length > 0) {
      addText(zip, "interactions.json", JSON.stringify(debuggerEvents.interactions, null, 2));
    }

    for (let i = 0; i < screenshots.length; i++) {
      const { dataUrl, annotatedBlob } = screenshots[i];
      const label = `screenshot-${i + 1}.png`;
      if (annotatedBlob) {
        work.push(() => addBlob(zip, label, annotatedBlob));
      } else {
        const bytes = Uint8Array.from(atob(dataUrl.split(",")[1] ?? ""), (c) => c.charCodeAt(0));
        const f = new ZipPassThrough(label);
        zip.add(f);
        f.push(bytes, true);
      }
    }

    for (const [key, html] of Object.entries(domSnapshots)) {
      addText(zip, `dom-snapshot-${key}.html`, html);
    }

    if (formValues.notes.trim()) {
      addText(zip, "notes.md", formValues.notes);
    }

    Promise.all(work.map((fn) => fn()))
      .then(() => zip.end())
      .catch(reject);
  });
}
