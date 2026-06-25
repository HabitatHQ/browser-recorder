import { reportNonFatalError } from "@/shared/lib/errors";
import { isDebuggerContentBridgePayload, sendDebuggerPageEvents } from "./messaging";

const INSTALL_FLAG = "__chromeRecorderDebuggerBridgeInstalled";

export function setupDebuggerContentBridge(): void {
  if (typeof window === "undefined") return;

  const scope = window as Window & { [INSTALL_FLAG]?: boolean };
  if (scope[INSTALL_FLAG]) return;
  scope[INSTALL_FLAG] = true;

  const queue: unknown[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const BATCH_SIZE = 40;
  const FLUSH_INTERVAL_MS = 120;

  const flushQueue = () => {
    flushTimer = null;
    if (queue.length === 0) return;
    const events = queue.splice(0, BATCH_SIZE);
    sendDebuggerPageEvents(events).catch((error: unknown) => {
      reportNonFatalError("Failed to forward debugger page events", error);
    });
    if (queue.length > 0) {
      flushTimer = setTimeout(flushQueue, 0);
    }
  };

  const scheduleFlush = () => {
    if (!flushTimer) flushTimer = setTimeout(flushQueue, FLUSH_INTERVAL_MS);
  };

  const enqueueEvents = (events: unknown[]) => {
    if (events.length === 0) return;
    for (const e of events) queue.push(e);
    if (queue.length >= BATCH_SIZE) {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flushQueue, 0);
    } else {
      scheduleFlush();
    }
  };

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window) return;
    if (!isDebuggerContentBridgePayload(event.data)) return;
    if (Array.isArray(event.data.events)) {
      enqueueEvents(event.data.events);
    } else {
      enqueueEvents([event.data.event]);
    }
  });

  window.addEventListener("pagehide", flushQueue, { capture: true });
}
