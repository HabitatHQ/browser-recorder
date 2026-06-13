import type { ScreenshotEntry, Session, SessionCounts, SubmitFormValues } from "@/lib/types";
import type {
  DebuggerActionEvent,
  DebuggerConsoleEvent,
  DebuggerNetworkEvent,
  DebuggerSSEEvent,
  DebuggerWebSocketEvent,
  ReportInput,
} from "@browser-recorder/core";
import { buildReportMd, buildTimeline } from "@browser-recorder/core";
import { Zip, ZipPassThrough } from "fflate";
import { buildReplayHtml } from "./replay-html";
import { buildReportHtml } from "./report-html";

const README = `\
# Bug report — Browser Recorder

Captured with [Browser Recorder](https://github.com/npalladium/chrome-recorder).

## Files

| File | Contents |
|---|---|
| report.html | **Start here.** Self-contained viewer — open in any browser, no server needed. Merges every channel into one filterable timeline, leads with a Problems panel (uncaught exceptions + failed requests), and links to screenshots, DOM snapshots and replay. |
| report.md | Human/agent-readable summary: title, description, notes, a Problems section, and tables for console errors, network requests, and interactions |
| events.json | Every channel merged into one timestamp-sorted timeline. Each entry has a \`seq\`, an \`offsetMs\` from session start, and \`initiatedBySeq\` linking it to the interaction that likely caused it. One file instead of cross-referencing the others by timestamp. |
| metadata.json | Session info: URL, duration, browser, OS, viewport, device pixel ratio, color scheme, network type, installed extensions, active service workers |
| console.json | Console events (log / info / warn / error / debug) captured during the session. Entries prefixed \`[uncaught]\` are unhandled JS exceptions; \`[unhandled rejection]\` are unhandled promise rejections. |
| network.json | XHR and fetch requests: URL, method, status, headers, body (truncated at 10 kB), timing |
| interactions.json | User interactions: clicks, inputs, navigations, scrolls with CSS selector paths |
| dom-snapshot-start.html | Page HTML captured at session start. Open in a browser — relative URLs resolve via \`<base href>\`. Cross-origin stylesheets are not inlined (CORS). |
| dom-snapshot-N.html | On-demand DOM snapshots taken during the session |
| screenshot-N.png | Screenshots taken during the session (annotations rasterised in) |
| video.webm | Tab recording (if enabled) |
| replay.html | Self-contained DOM session replay (experimental). Open in any browser — scrub, play, and pause a reconstruction of the page. No extension or network needed. |
| replay.json | Raw rrweb events behind replay.html, for tooling. |
| _browser_recorder_self_diagnostics.json | Self-diagnostics from the recorder itself: per-feature capture health (what was enabled, what produced data, any non-fatal errors). Use it to tell "the app had no console errors" apart from "console capture silently failed". |

## Notes

- **Browser-native console entries** (e.g. \`ERR_BLOCKED_BY_CLIENT\`, preload warnings) are not present in console.json — they are injected into DevTools directly by Chrome and do not go through the JS \`console\` API.
- Console and network capture only covers events that occurred **after the session was started**.
- Sensitive headers (\`Authorization\`, \`Cookie\`) are redacted to \`[REDACTED]\` by default.
- A network entry marked \`"dropped": true\` was deliberately removed by the submitter during review — only that the request happened (method, URL, status) is kept; headers and bodies are gone. report.md notes how many requests were dropped and how many fields were redacted.
`;

export interface ExportInclude {
  console: boolean;
  network: boolean;
  interactions: boolean;
  screenshots: boolean;
  domSnapshots: boolean;
  replay: boolean;
}

const DEFAULT_INCLUDE: ExportInclude = {
  console: true,
  network: true,
  interactions: true,
  screenshots: true,
  domSnapshots: true,
  replay: true,
};

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
    websocket?: unknown[];
    sse?: unknown[];
  };
  /** rrweb session-replay events (experimental); omitted/empty → no replay files. */
  replayEvents?: unknown[];
  /** Capture-health diagnostics; written as _browser_recorder_self_diagnostics.json. */
  diagnostics?: unknown;
  nestInFolder?: boolean;
  zipTitleFilename?: boolean;
  /** Per-artifact include toggles from the review screen; omitted → include all. */
  include?: ExportInclude;
  /** Count of fields the submitter redacted during review (for the report note). */
  redactedFieldCount?: number;
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

export function toFilenameTimestamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/, "");
}

/** Shared base-name logic used by the zip export and video/screenshot downloads. */
export function computeExportBaseName(
  formValues: Pick<SubmitFormValues, "title">,
  session: Session | null,
  zipTitleFilename: boolean,
  now: Date
): string {
  if (zipTitleFilename) {
    const s = slugify(formValues.title);
    return s
      ? `browser-recording-${s}-${toFilenameTimestamp(now)}`
      : `browser-recording-${toFilenameTimestamp(now)}`;
  }
  const rawSlug =
    formValues.title && formValues.title !== "Bug report"
      ? formValues.title
      : session?.tabUrl
        ? (() => {
            try {
              return new URL(session.tabUrl).hostname;
            } catch {
              return "";
            }
          })()
        : "";
  const slug = slugify(rawSlug);
  return `browser-recording${slug ? `-${slug}` : ""}-${toFilenameTimestamp(now)}`;
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
  const {
    session,
    formValues,
    screenshots,
    domSnapshots,
    debuggerEvents,
    replayEvents = [],
    diagnostics,
    nestInFolder = true,
    zipTitleFilename = false,
    redactedFieldCount = 0,
  } = input;

  const include = { ...DEFAULT_INCLUDE, ...input.include };

  // Effective per-channel arrays: an unchecked channel contributes nothing to
  // any artifact (json file, report.md table, events.json timeline, viewer).
  const consoleEvents = (include.console ? debuggerEvents.console : []) as DebuggerConsoleEvent[];
  const networkEvents = (include.network ? debuggerEvents.network : []) as DebuggerNetworkEvent[];
  const interactions = (
    include.interactions ? debuggerEvents.interactions : []
  ) as DebuggerActionEvent[];
  const websocket = (
    include.network ? (debuggerEvents.websocket ?? []) : []
  ) as DebuggerWebSocketEvent[];
  const sse = (include.network ? (debuggerEvents.sse ?? []) : []) as DebuggerSSEEvent[];

  const reportInput: ReportInput = {
    title: formValues.title,
    description: formValues.description,
    notes: formValues.notes,
    url: session?.tabUrl ?? null,
    startedAt: session?.startedAt ?? null,
    consoleEvents,
    networkEvents,
    interactions,
    redactedFieldCount,
  };

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
          reg.active?.scriptURL ?? reg.installing?.scriptURL ?? reg.waiting?.scriptURL ?? "",
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
  const baseName = computeExportBaseName(formValues, session, zipTitleFilename, now);
  const filename = `${baseName}.zip`;
  const prefix = nestInFolder ? `${baseName}/` : "";

  const timeline = buildTimeline({
    startedAt: session?.startedAt ?? null,
    console: consoleEvents,
    network: networkEvents,
    interactions,
    websocket,
    sse,
  });

  const screenshotNames = include.screenshots
    ? screenshots.map((_, i) => `screenshot-${i + 1}.png`)
    : [];
  const domSnapshotNames = include.domSnapshots
    ? Object.keys(domSnapshots).map((key) => `dom-snapshot-${key}.html`)
    : [];
  const replayName = include.replay && replayEvents.length > 1 ? "replay.html" : null;

  const metadata = {
    title: formValues.title,
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

    addText(zip, `${prefix}README.md`, README);
    addText(zip, `${prefix}report.md`, buildReportMd(reportInput, now));
    addText(
      zip,
      `${prefix}report.html`,
      buildReportHtml({
        title: formValues.title,
        url: session?.tabUrl ?? null,
        durationMs: metadata.sessionDurationMs,
        recordedIso: now.toISOString(),
        device: {
          browser: metadata.deviceInfo.browser,
          os: metadata.deviceInfo.os,
          viewport: metadata.deviceInfo.viewport,
        },
        timeline,
        screenshots: screenshotNames,
        domSnapshots: domSnapshotNames,
        video: null,
        replay: replayName,
      })
    );
    addText(zip, `${prefix}metadata.json`, JSON.stringify(metadata, null, 2));

    if (timeline.length > 0) {
      addText(zip, `${prefix}events.json`, JSON.stringify(timeline, null, 2));
    }

    if (consoleEvents.length > 0) {
      addText(zip, `${prefix}console.json`, JSON.stringify(consoleEvents, null, 2));
    }

    if (networkEvents.length > 0) {
      addText(zip, `${prefix}network.json`, JSON.stringify(networkEvents, null, 2));
    }

    if (interactions.length > 0) {
      addText(zip, `${prefix}interactions.json`, JSON.stringify(interactions, null, 2));
    }

    if (include.screenshots) {
      for (let i = 0; i < screenshots.length; i++) {
        const { dataUrl, annotatedBlob } = screenshots[i];
        const label = `${prefix}screenshot-${i + 1}.png`;
        if (annotatedBlob) {
          work.push(() => addBlob(zip, label, annotatedBlob));
        } else {
          const bytes = Uint8Array.from(atob(dataUrl.split(",")[1] ?? ""), (c) => c.charCodeAt(0));
          const f = new ZipPassThrough(label);
          zip.add(f);
          f.push(bytes, true);
        }
      }
    }

    if (include.domSnapshots) {
      for (const [key, html] of Object.entries(domSnapshots)) {
        addText(zip, `${prefix}dom-snapshot-${key}.html`, html);
      }
    }

    if (replayName) {
      addText(zip, `${prefix}replay.json`, JSON.stringify(replayEvents));
      addText(zip, `${prefix}replay.html`, buildReplayHtml(replayEvents, formValues.title));
    }

    if (diagnostics) {
      addText(
        zip,
        `${prefix}_browser_recorder_self_diagnostics.json`,
        JSON.stringify(diagnostics, null, 2)
      );
    }

    Promise.all(work.map((fn) => fn()))
      .then(() => zip.end())
      .catch(reject);
  });
}
