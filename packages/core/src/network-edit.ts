import { type NetworkField, redactMatches, scanText } from "./redact.js";
import type { DebuggerNetworkEvent } from "./types.js";

export interface NetworkEdit {
  /** Replace this request with a tombstone (records that it existed, strips content). */
  drop?: boolean;
  /** Fields to redact: each is re-scanned and its detected secrets replaced with [REDACTED]. */
  redactFields?: NetworkField[];
}

export interface NetworkEditResult {
  network: DebuggerNetworkEvent[];
  droppedCount: number;
  /** Number of (event, field) pairs that were redacted. */
  redactedCount: number;
}

function tombstone(ev: DebuggerNetworkEvent): DebuggerNetworkEvent {
  return {
    kind: "network",
    timestamp: ev.timestamp,
    method: ev.method,
    url: ev.url,
    status: ev.status,
    dropped: true,
  };
}

function redactField(ev: DebuggerNetworkEvent, field: NetworkField): boolean {
  if (field.area === "url") {
    const next = redactMatches(ev.url, scanText(ev.url));
    if (next === ev.url) return false;
    ev.url = next;
    return true;
  }
  if (field.area === "requestBody" || field.area === "responseBody") {
    const current = ev[field.area];
    if (!current) return false;
    const next = redactMatches(current, scanText(current));
    if (next === current) return false;
    ev[field.area] = next;
    return true;
  }
  const bag = field.area === "requestHeader" ? ev.requestHeaders : ev.responseHeaders;
  if (!bag || !field.name) return false;
  const current = bag[field.name];
  if (current === undefined) return false;
  const next = redactMatches(current, scanText(current));
  if (next === current) return false;
  bag[field.name] = next;
  return true;
}

/**
 * Apply submitter review decisions to network events. Pure and non-mutating —
 * returns fresh objects. With no edits it is a no-op, so a flagged-but-kept
 * secret (intentional internal value, false positive) survives verbatim.
 */
export function applyNetworkEdits(
  events: DebuggerNetworkEvent[],
  edits: Record<number, NetworkEdit>,
): NetworkEditResult {
  let droppedCount = 0;
  let redactedCount = 0;

  const network = events.map((ev, i) => {
    const edit = edits[i];
    if (!edit) return ev;
    if (edit.drop) {
      droppedCount++;
      return tombstone(ev);
    }
    if (edit.redactFields && edit.redactFields.length > 0) {
      const clone: DebuggerNetworkEvent = {
        ...ev,
        requestHeaders: ev.requestHeaders ? { ...ev.requestHeaders } : undefined,
        responseHeaders: ev.responseHeaders ? { ...ev.responseHeaders } : undefined,
      };
      for (const field of edit.redactFields) {
        if (redactField(clone, field)) redactedCount++;
      }
      return clone;
    }
    return ev;
  });

  return { network, droppedCount, redactedCount };
}
