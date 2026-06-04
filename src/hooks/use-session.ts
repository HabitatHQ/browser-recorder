import { sendToBackground } from "@/lib/messaging";
import type { Session, SessionCounts } from "@/lib/types";
import { useEffect, useState } from "react";

interface SessionState {
  session: Session | null;
  counts: SessionCounts;
  loading: boolean;
}

const emptyCounts: SessionCounts = {
  console: 0,
  network: 0,
  interactions: 0,
  domSnapshots: 0,
  screenshots: 0,
  errors: 0,
};

export function useSession() {
  const [state, setState] = useState<SessionState>({
    session: null,
    counts: emptyCounts,
    loading: true,
  });

  useEffect(() => {
    // Initial load — background holds authoritative in-memory state
    Promise.all([
      sendToBackground<Session | null>({ type: "get-session" }),
      sendToBackground<SessionCounts>({ type: "get-counts" }),
    ])
      .then(([session, counts]) => {
        setState({ session, counts: counts ?? emptyCounts, loading: false });
      })
      .catch(() => setState((s) => ({ ...s, loading: false })));

    // Subsequent updates are pushed via write-through storage
    function onStorageChanged(changes: Record<string, chrome.storage.StorageChange>) {
      setState((prev) => {
        const next = { ...prev };
        if ("session" in changes)
          next.session = (changes.session.newValue ?? null) as Session | null;
        if ("counts" in changes)
          next.counts = (changes.counts.newValue ?? emptyCounts) as SessionCounts;
        return next;
      });
    }
    chrome.storage.session.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.session.onChanged.removeListener(onStorageChanged);
  }, []);

  return state;
}

export function useElapsedMs(startedAt: number | null): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Date.now() - startedAt);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return elapsed;
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
