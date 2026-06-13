import {
  REPLAY_BRIDGE_SOURCE,
  REPLAY_EVENTS_MESSAGE,
  isReplayPagePayload,
  isReplayStopMessage,
} from "@/lib/replay-messaging";

// ISOLATED-world bridge between the MAIN-world rrweb recorder and the background.
// Batches page events and forwards them over chrome.runtime.sendMessage, and
// relays the session-stop signal back into the page. Mirrors the debugger
// content bridge.
const INSTALL_FLAG = "__recorderReplayBridgeInstalled";
const BATCH_SIZE = 40;
const FLUSH_INTERVAL_MS = 250;

export default defineUnlistedScript(() => {
  if (typeof window === "undefined") return;
  const scope = window as Window & { [INSTALL_FLAG]?: boolean };
  if (scope[INSTALL_FLAG]) return;
  scope[INSTALL_FLAG] = true;

  const queue: unknown[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const send = (events: unknown[]): Promise<void> =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: REPLAY_EVENTS_MESSAGE, events }, () => {
          // Swallow "receiving end does not exist" etc. — the session may have ended.
          void chrome.runtime.lastError;
          resolve();
        });
      } catch {
        resolve();
      }
    });

  const flush = async (): Promise<void> => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    while (queue.length > 0) {
      await send(queue.splice(0, BATCH_SIZE));
    }
  };

  const scheduleFlush = () => {
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        void flush();
      }, FLUSH_INTERVAL_MS);
    }
  };

  window.addEventListener("message", (e: MessageEvent<unknown>) => {
    if (e.source !== window || !isReplayPagePayload(e.data) || e.data.kind !== "event") return;
    queue.push(e.data.event);
    if (queue.length >= BATCH_SIZE) {
      void flush();
    } else {
      scheduleFlush();
    }
  });

  // Background asks us to stop: relay into the page to stop rrweb, drain the
  // queue, and only then acknowledge — so the background can finalize the OPFS
  // file knowing every event has been forwarded.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isReplayStopMessage(msg)) return undefined;
    window.postMessage({ source: REPLAY_BRIDGE_SOURCE, kind: "stop" }, "*");
    flush().then(() => sendResponse({ ok: true }));
    return true; // keep the channel open for the async flush
  });

  window.addEventListener(
    "pagehide",
    () => {
      void flush();
    },
    { capture: true }
  );
});
