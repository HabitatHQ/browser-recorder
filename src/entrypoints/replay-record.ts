import { REPLAY_BRIDGE_SOURCE, isReplayPagePayload } from "@/lib/replay-messaging";
import { record } from "rrweb";

// MAIN-world rrweb recorder. Events are streamed out of the page immediately via
// window.postMessage to the ISOLATED content bridge, which forwards them to the
// background to append to OPFS. Because nothing is buffered in page memory, a
// full-document navigation/reload no longer loses the recording: the background
// re-injects this script on the new document and rrweb emits a fresh full
// snapshot, so the appended event stream stays continuous across reloads.
interface ReplayWindow extends Window {
  __recorderReplayActive?: boolean;
  __recorderReplayStop?: () => void;
}

export default defineUnlistedScript(() => {
  const w = window as ReplayWindow;
  if (w.__recorderReplayActive) return;
  w.__recorderReplayActive = true;

  const stop = record({
    emit(event) {
      window.postMessage({ source: REPLAY_BRIDGE_SOURCE, kind: "event", event }, "*");
    },
    // Inline same-origin styles/fonts so the replay renders without the original
    // network. Cross-origin assets can't be inlined (CORS).
    inlineStylesheet: true,
    collectFonts: true,
    recordCanvas: false,
  });

  const teardown = () => {
    try {
      stop?.();
    } catch {
      // recorder already torn down
    }
    w.__recorderReplayActive = false;
  };
  w.__recorderReplayStop = teardown;

  // The content bridge relays a stop signal here when the session ends.
  window.addEventListener("message", (e: MessageEvent<unknown>) => {
    if (e.source !== window || !isReplayPagePayload(e.data)) return;
    if (e.data.kind === "stop") teardown();
  });
});
