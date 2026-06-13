// Wire protocol for streaming rrweb replay events out of the recorded page.
//
//   page (MAIN world, replay-record.ts)
//     → window.postMessage ─────────────► content bridge (ISOLATED, replay-content-bridge.ts)
//     ◄──────── window.postMessage (stop) ┘
//   content bridge
//     → chrome.runtime.sendMessage(REPLAY_EVENTS) ──► background (append to OPFS)
//   background
//     → chrome.tabs.sendMessage(REPLAY_STOP) ───────► content bridge (flush + stop rrweb)
//
// Mirrors the debugger bridge so events leave the page as they happen — a page
// reload no longer drops the buffer.

export const REPLAY_BRIDGE_SOURCE = "chrome-recorder-replay";
export const REPLAY_EVENTS_MESSAGE = "replay-events";
export const REPLAY_STOP_MESSAGE = "replay-stop";

/** page ↔ content-bridge messages, carried over window.postMessage. */
export type ReplayPagePayload =
  | { source: typeof REPLAY_BRIDGE_SOURCE; kind: "event"; event: unknown }
  | { source: typeof REPLAY_BRIDGE_SOURCE; kind: "stop" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isReplayPagePayload(value: unknown): value is ReplayPagePayload {
  return isRecord(value) && value.source === REPLAY_BRIDGE_SOURCE;
}

/** content-bridge → background, over chrome.runtime.sendMessage. */
export interface ReplayEventsMessage {
  type: typeof REPLAY_EVENTS_MESSAGE;
  events: unknown[];
}

export function isReplayEventsMessage(value: unknown): value is ReplayEventsMessage {
  return isRecord(value) && value.type === REPLAY_EVENTS_MESSAGE && Array.isArray(value.events);
}

/** background → content-bridge, over chrome.tabs.sendMessage. */
export interface ReplayStopMessage {
  type: typeof REPLAY_STOP_MESSAGE;
}

export function isReplayStopMessage(value: unknown): value is ReplayStopMessage {
  return isRecord(value) && value.type === REPLAY_STOP_MESSAGE;
}
