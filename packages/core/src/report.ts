import type { ReportInput } from "./types.js";

export function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

export function formatOffset(deltaMs: number): string {
  const ms = Math.max(0, deltaMs);
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `+${pad(min)}:${pad(sec)}`;
}

export function escapeCell(text: string): string {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function isUncaught(message: string): boolean {
  return message.startsWith("[uncaught]") || message.startsWith("[unhandled rejection]");
}

export function buildReportMd(input: ReportInput, now: Date): string {
  const {
    title,
    description,
    notes,
    url,
    startedAt,
    consoleEvents,
    networkEvents,
    interactions,
    redactedFieldCount = 0,
  } = input;
  const parts: string[] = [];
  const offset = (ts: number) => (startedAt !== null ? formatOffset(ts - startedAt) : "—");

  parts.push(`# ${title || "Bug report"}`);
  parts.push("");

  if (url) parts.push(`**URL:** ${url}  `);
  if (startedAt !== null)
    parts.push(`**Duration:** ${formatDuration(now.getTime() - startedAt)}  `);
  parts.push(`**Recorded:** ${now.toISOString()}`);
  parts.push("");

  // Problems first — the reviewer's "what's wrong" answer, before the raw logs.
  const exceptions = consoleEvents.filter((e) => e.level === "error" && isUncaught(e.message));
  const otherErrors = consoleEvents.filter((e) => e.level === "error" && !isUncaught(e.message));
  const failedRequests = networkEvents.filter((e) => e.status !== undefined && e.status >= 400);
  if (exceptions.length + otherErrors.length + failedRequests.length > 0) {
    parts.push("## Problems");
    parts.push("");
    for (const e of exceptions) {
      parts.push(`- **${offset(e.timestamp)}** uncaught: ${escapeCell(e.message.slice(0, 160))}`);
    }
    for (const e of otherErrors) {
      parts.push(`- **${offset(e.timestamp)}** console error: ${escapeCell(e.message.slice(0, 160))}`);
    }
    for (const e of failedRequests) {
      const u = e.url.length > 80 ? `${e.url.slice(0, 77)}...` : e.url;
      parts.push(`- **${offset(e.timestamp)}** ${e.status} ${e.method} ${escapeCell(u)}`);
    }
    parts.push("");
  }

  if (description.trim()) {
    parts.push("## Description");
    parts.push("");
    parts.push(description.trim());
    parts.push("");
  }

  if (notes.trim()) {
    parts.push("## Notes");
    parts.push("");
    parts.push(notes.trim());
    parts.push("");
  }

  if (consoleEvents.length > 0) {
    const errorCount = consoleEvents.filter((e) => e.level === "error").length;
    parts.push(
      errorCount > 0
        ? `## Console (${consoleEvents.length} events, ${errorCount} error${errorCount !== 1 ? "s" : ""})`
        : `## Console (${consoleEvents.length} events)`,
    );
    parts.push("");
    parts.push("| Time | Level | Message |");
    parts.push("|------|-------|---------|");
    for (const ev of consoleEvents) {
      const time = startedAt !== null ? formatOffset(ev.timestamp - startedAt) : "—";
      parts.push(`| ${time} | ${ev.level} | ${escapeCell(ev.message.slice(0, 120))} |`);
    }
    parts.push("");
  }

  if (networkEvents.length > 0) {
    const failedCount = networkEvents.filter(
      (e) => e.status !== undefined && e.status >= 400,
    ).length;
    parts.push(
      failedCount > 0
        ? `## Network (${networkEvents.length} requests, ${failedCount} failed)`
        : `## Network (${networkEvents.length} requests)`,
    );
    parts.push("");
    parts.push("| Time | Method | URL | Status | Duration |");
    parts.push("|------|--------|-----|--------|----------|");
    for (const ev of networkEvents) {
      const time = startedAt !== null ? formatOffset(ev.timestamp - startedAt) : "—";
      const url = escapeCell(ev.url.length > 80 ? `${ev.url.slice(0, 77)}...` : ev.url);
      const status = ev.dropped ? `${ev.status ?? "—"} (dropped)` : (ev.status ?? "—");
      const duration = ev.dropped ? "—" : ev.duration !== undefined ? `${ev.duration}ms` : "—";
      parts.push(`| ${time} | ${ev.method} | ${url} | ${status} | ${duration} |`);
    }
    parts.push("");

    const droppedCount = networkEvents.filter((e) => e.dropped).length;
    if (droppedCount > 0 || redactedFieldCount > 0) {
      const notes: string[] = [];
      if (droppedCount > 0)
        notes.push(
          `${droppedCount} request${droppedCount !== 1 ? "s" : ""} dropped by the submitter (content removed; only that the request happened is recorded)`,
        );
      if (redactedFieldCount > 0)
        notes.push(
          `${redactedFieldCount} field${redactedFieldCount !== 1 ? "s" : ""} redacted by the submitter`,
        );
      parts.push(`> Privacy: ${notes.join("; ")}.`);
      parts.push("");
    }
  }

  if (interactions.length > 0) {
    parts.push(`## Interactions (${interactions.length} events)`);
    parts.push("");
    parts.push("| Time | Type | Target |");
    parts.push("|------|------|--------|");
    for (const ev of interactions) {
      const time = startedAt !== null ? formatOffset(ev.timestamp - startedAt) : "—";
      const target = ev.target ? escapeCell(ev.target.slice(0, 80)) : "—";
      parts.push(`| ${time} | ${ev.actionType} | ${target} |`);
    }
    parts.push("");
  }

  return parts.join("\n");
}
