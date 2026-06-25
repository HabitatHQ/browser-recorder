// Experimental replay preprocessing. rrweb renders the replay into a sandboxed
// iframe without `allow-scripts` (so captured page scripts never run during
// replay). If the recorded DOM carried an `autofocus` attribute, Chrome refuses
// to honor it in that sandbox and logs a "Blocked autofocusing… frame is
// sandboxed" warning on every replay load. Stripping the attribute before
// handing events to the Replayer silences that noise; it changes nothing about
// the replay (focus-stealing during replay is undesirable anyway).
//
// Gated behind the `replayStripAutofocus` experimental flag — see
// src/components/replay-player.tsx and DEFAULT_CAPTURE_CONFIG.

// rrweb event/source constants (stable across rrweb 2.x). Hard-coded as literals
// rather than imported from rrweb so this stays a tiny, dependency-free pure
// module that's trivial to unit-test.
const EVENT_FULL_SNAPSHOT = 2;
const EVENT_INCREMENTAL = 3;
const INCREMENTAL_MUTATION = 0;

// rrweb events are opaque JSON; we only touch a few known fields and pass
// everything else through untouched.
// biome-ignore lint/suspicious/noExplicitAny: events are untyped rrweb JSON.
type AnyEvent = any;

// Recursively delete `autofocus` from a serialized rrweb DOM node and its
// children. Stripped by attribute name regardless of tag — autofocus is valid on
// input, textarea, button, select, and contenteditable elements.
function stripNodeInPlace(node: AnyEvent): void {
  if (!node || typeof node !== "object") return;
  if (node.attributes && typeof node.attributes === "object") {
    // Must remove the key entirely — setting it undefined would make rrweb's
    // rebuild write autofocus="undefined", still triggering the autofocus.
    // biome-ignore lint/performance/noDelete: key removal is required, see above.
    delete node.attributes.autofocus;
  }
  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) stripNodeInPlace(child);
  }
}

// Strip autofocus from a single DOM-bearing event (already a private clone).
function stripEventInPlace(event: AnyEvent): void {
  if (event?.type === EVENT_FULL_SNAPSHOT) {
    stripNodeInPlace(event.data?.node);
    return;
  }
  // Incremental mutation: nodes can be added (`adds`) or have attributes set
  // (`attributes`) mid-session, either of which may reintroduce autofocus.
  const data = event?.data;
  if (Array.isArray(data?.adds)) {
    for (const add of data.adds) stripNodeInPlace(add?.node);
  }
  if (Array.isArray(data?.attributes)) {
    for (const mutation of data.attributes) {
      if (mutation?.attributes && typeof mutation.attributes === "object") {
        // biome-ignore lint/performance/noDelete: key removal is required, see stripNodeInPlace.
        delete mutation.attributes.autofocus;
      }
    }
  }
}

/**
 * Return a new events array with `autofocus` stripped from every serialized DOM
 * node. Cost is proportional to DOM content, not recording length: only
 * FullSnapshot and mutation events are cloned (the unavoidable minimum); the
 * many mouse-move/scroll events pass through by reference, so the caller's
 * original array (e.g. the export bundle) is left untouched.
 */
export function stripReplayAutofocus(events: unknown[]): unknown[] {
  return events.map((event) => {
    const e = event as AnyEvent;
    const isFullSnapshot = e?.type === EVENT_FULL_SNAPSHOT;
    const isMutation = e?.type === EVENT_INCREMENTAL && e?.data?.source === INCREMENTAL_MUTATION;
    if (!isFullSnapshot && !isMutation) return event;
    const clone = structuredClone(e);
    stripEventInPlace(clone);
    return clone;
  });
}
