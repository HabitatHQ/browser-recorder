import type { DebuggerNetworkEvent } from "./types.js";

/**
 * A request the user is about to replay. Seeded from a captured entry, then
 * freely editable in the replay UI. Distinct from "session replay" (rrweb-style
 * playback) elsewhere in the codebase — this is HTTP request replay.
 * See docs/plans/request-replay.md.
 */
export interface ReplayRequestInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

/** Outcome of executing a replay in the page. */
export type ReplayResult =
  | {
      outcome: "response";
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: string;
      bodyTruncated: boolean;
      durationMs: number;
      redirected: boolean;
      finalUrl: string;
    }
  | { outcome: "error"; error: string; durationMs: number };

/** Prefill an editable replay request from a captured network entry. */
export function seedReplayInput(ev: DebuggerNetworkEvent): ReplayRequestInput {
  return {
    method: ev.method || "GET",
    url: ev.url,
    headers: ev.requestHeaders ? { ...ev.requestHeaders } : {},
    body: ev.requestBody,
  };
}

/** Render headers as editable `Name: value` lines (insertion order preserved). */
export function headersToText(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n");
}

/**
 * Parse `Name: value` lines back into a header map. Blank lines are skipped;
 * a line's first colon is the split point (values may contain colons); names
 * and values are trimmed; lines without a colon are ignored.
 */
export function parseHeadersText(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const name = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (name) headers[name] = value;
  }
  return headers;
}
