import type {
  DebuggerActionEvent,
  DebuggerConsoleEvent,
  DebuggerEvent,
  DebuggerNetworkEvent,
  DebuggerSSEEvent,
  DebuggerWebSocketEvent,
} from "./types.js";

export type TimelineKind = "console" | "network" | "action" | "websocket" | "sse";

export interface TimelineEntry {
  /** 1-based position in the merged, timestamp-sorted timeline. */
  seq: number;
  kind: TimelineKind;
  timestamp: number;
  /** Milliseconds since the session started, or null if the start is unknown. */
  offsetMs: number | null;
  /**
   * seq of the nearest interaction at or before this event (within the
   * correlation window), or null. Interactions themselves are never correlated.
   * Lets a reviewer answer "what did clicking Submit fire?" without timestamp
   * arithmetic across files.
   */
  initiatedBySeq: number | null;
  event: DebuggerEvent;
}

export interface TimelineInput {
  startedAt: number | null;
  console: DebuggerConsoleEvent[];
  network: DebuggerNetworkEvent[];
  interactions: DebuggerActionEvent[];
  websocket?: DebuggerWebSocketEvent[];
  sse?: DebuggerSSEEvent[];
}

export interface TimelineOptions {
  /** Max gap between an interaction and a following event for them to be linked. */
  correlationWindowMs?: number;
}

const DEFAULT_CORRELATION_WINDOW_MS = 5000;

/**
 * Merge every capture channel into a single timestamp-sorted timeline, stamping
 * each entry with a monotonic seq, a relative offset, and a best-effort link to
 * the interaction that likely caused it. This is the shape written to
 * events.json and consumed by the HTML report — one sorted file instead of the
 * reviewer hand-merging three by eyeballing unix timestamps.
 */
export function buildTimeline(input: TimelineInput, options: TimelineOptions = {}): TimelineEntry[] {
  const window = options.correlationWindowMs ?? DEFAULT_CORRELATION_WINDOW_MS;
  const { startedAt } = input;

  // Channels are pushed in a fixed order so equal-timestamp ties resolve
  // deterministically (network → action → console → websocket → sse).
  const staged: Array<{ kind: TimelineKind; event: DebuggerEvent; order: number }> = [];
  let order = 0;
  const stage = (kind: TimelineKind, events: DebuggerEvent[] | undefined) => {
    for (const event of events ?? []) staged.push({ kind, event, order: order++ });
  };
  stage("network", input.network);
  stage("action", input.interactions);
  stage("console", input.console);
  stage("websocket", input.websocket);
  stage("sse", input.sse);

  staged.sort((a, b) => a.event.timestamp - b.event.timestamp || a.order - b.order);

  let lastActionSeq: number | null = null;
  let lastActionTs: number | null = null;

  return staged.map(({ kind, event }, index) => {
    const seq = index + 1;
    let initiatedBySeq: number | null = null;
    if (kind === "action") {
      lastActionSeq = seq;
      lastActionTs = event.timestamp;
    } else if (
      lastActionSeq !== null &&
      lastActionTs !== null &&
      event.timestamp - lastActionTs <= window
    ) {
      initiatedBySeq = lastActionSeq;
    }
    return {
      seq,
      kind,
      timestamp: event.timestamp,
      offsetMs: startedAt === null ? null : event.timestamp - startedAt,
      initiatedBySeq,
      event,
    };
  });
}
