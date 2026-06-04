import type { ScreenshotEntry, Session, SessionCounts, SubmitFormValues } from "@/lib/types";
import { Zip, ZipPassThrough } from "fflate";

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
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    "T",
    pad(d.getHours()),
    "-",
    pad(d.getMinutes()),
    "-",
    pad(d.getSeconds()),
  ].join("");
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

  const now = new Date();
  const filename = `report-${toFilenameTimestamp(now)}.zip`;

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
    },
    extensions,
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
