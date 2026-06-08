import { Zip, ZipPassThrough } from "fflate";
import { createWriteStream } from "node:fs";
import { buildReportMd } from "@browser-recorder/core";
import type {
  ReportInput,
  DebuggerConsoleEvent,
  DebuggerNetworkEvent,
  DebuggerActionEvent,
} from "@browser-recorder/core";

export interface CliExportInput {
  title: string;
  description: string;
  notes: string;
  url: string | null;
  startedAt: number;
  consoleEvents: DebuggerConsoleEvent[];
  networkEvents: DebuggerNetworkEvent[];
  interactions: DebuggerActionEvent[];
  screenshots: Buffer[]; // PNG buffers
  domSnapshots: Record<string, string>; // key → html
}

export async function exportZip(input: CliExportInput, outputPath: string): Promise<void> {
  const now = new Date();

  const reportInput: ReportInput = {
    title: input.title,
    description: input.description,
    notes: input.notes,
    url: input.url,
    startedAt: input.startedAt,
    consoleEvents: input.consoleEvents,
    networkEvents: input.networkEvents,
    interactions: input.interactions,
  };

  const metadata = {
    title: input.title,
    url: input.url,
    timestamp: now.toISOString(),
    sessionDurationMs: now.getTime() - input.startedAt,
  };

  const README = `# Bug report — browser-recorder CLI\n\nCaptured with browser-recorder CLI.\n\n| File | Contents |\n|---|---|\n| report.md | Human/agent-readable summary |\n| metadata.json | Session info |\n| console.json | Console events |\n| network.json | Network requests |\n| interactions.json | User interactions |\n| dom-snapshot-*.html | DOM snapshots |\n| screenshot-*.png | Screenshots |\n`;

  return new Promise((resolve, reject) => {
    const out = createWriteStream(outputPath);
    const zip = new Zip((err, chunk, final) => {
      if (err) {
        reject(err);
        return;
      }
      out.write(chunk);
      if (final) out.end(resolve);
    });

    const addText = (name: string, text: string) => {
      const f = new ZipPassThrough(name);
      zip.add(f);
      f.push(new TextEncoder().encode(text), true);
    };
    const addBuf = (name: string, buf: Buffer) => {
      const f = new ZipPassThrough(name);
      zip.add(f);
      f.push(new Uint8Array(buf), true);
    };

    addText("README.md", README);
    addText("report.md", buildReportMd(reportInput, now));
    addText("metadata.json", JSON.stringify(metadata, null, 2));

    if (input.consoleEvents.length > 0)
      addText("console.json", JSON.stringify(input.consoleEvents, null, 2));
    if (input.networkEvents.length > 0)
      addText("network.json", JSON.stringify(input.networkEvents, null, 2));
    if (input.interactions.length > 0)
      addText("interactions.json", JSON.stringify(input.interactions, null, 2));

    for (let i = 0; i < input.screenshots.length; i++)
      addBuf(`screenshot-${i + 1}.png`, input.screenshots[i]);

    for (const [key, html] of Object.entries(input.domSnapshots))
      addText(`dom-snapshot-${key}.html`, html);

    zip.end();
  });
}
