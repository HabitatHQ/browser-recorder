import { DEBUGGER_SESSIONS_STORAGE_KEY } from "@/capture-core/debugger/constants";
import {
  appendActionEventWithDedup,
  appendEventWithRetentionPolicy,
  appendNetworkEventWithDedup,
} from "@/capture-core/debugger/engine/background/retention";
import { normalizeDebuggerEvent, normalizeStoredSession } from "@/capture-core/debugger/normalize";
import type {
  DebuggerEvent,
  DebuggerSessionSnapshot,
  StoredDebuggerSession,
} from "@/capture-core/debugger/types";
import { reportNonFatalError } from "@/shared/lib/errors";
import { createSessionId, injectDebuggerScriptIntoTab, isInjectablePageUrl } from "./injection";

interface StartSessionPayload {
  captureTabId: number;
  captureType: "video" | "screenshot";
  instantReplayLookbackMs?: number;
}

export interface DebuggerSessionStore {
  injectDebuggerScriptForTab(tabId: number): Promise<void>;
  startSession(payload: StartSessionPayload): Promise<{ sessionId: string; startedAt: number }>;
  appendPageEvents(tabId: number, rawEvents: unknown[]): Promise<void>;
  getSessionSnapshot(sessionId: string): Promise<DebuggerSessionSnapshot | null>;
  markSessionRecordingStarted(payload: {
    sessionId: string;
    recordingStartedAt: number;
  }): Promise<void>;
  discardSession(sessionId: string): Promise<void>;
  ensureDebuggerScriptForTab(tabId: number, url?: string): Promise<void>;
  discardSessionByTabId(tabId: number): Promise<void>;
}

export function createDebuggerSessionStore(): DebuggerSessionStore {
  const sessionsById = new Map<string, StoredDebuggerSession>();
  const tabToSession = new Map<number, string>();
  const recentEventsByTab = new Map<number, DebuggerEvent[]>();

  let isLoaded = false;
  let loadPromise: Promise<void> | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const schedulePersist = () => {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      chrome.storage.local
        .set({ [DEBUGGER_SESSIONS_STORAGE_KEY]: Array.from(sessionsById.values()) })
        .catch((err: unknown) => reportNonFatalError("Failed to persist debugger state", err));
    }, 250);
  };

  const ensureLoaded = async () => {
    if (isLoaded) return;
    if (loadPromise) {
      await loadPromise;
      return;
    }
    loadPromise = chrome.storage.local
      .get([DEBUGGER_SESSIONS_STORAGE_KEY])
      .then((result) => {
        const stored = result[DEBUGGER_SESSIONS_STORAGE_KEY];
        if (!Array.isArray(stored)) return;
        for (const candidate of stored) {
          const session = normalizeStoredSession(candidate);
          if (!session) continue;
          sessionsById.set(session.sessionId, session);
          tabToSession.set(session.captureTabId, session.sessionId);
        }
      })
      .catch((err: unknown) => reportNonFatalError("Failed to load debugger state", err))
      .finally(() => {
        isLoaded = true;
        loadPromise = null;
      });
    await loadPromise;
  };

  const removeSession = (sessionId: string) => {
    const session = sessionsById.get(sessionId);
    if (!session) return;
    sessionsById.delete(sessionId);
    if (tabToSession.get(session.captureTabId) === sessionId) {
      tabToSession.delete(session.captureTabId);
    }
  };

  const appendEventsToSession = (tabId: number, events: DebuggerEvent[]) => {
    if (events.length === 0) return;
    const sessionId = tabToSession.get(tabId);
    const session = sessionId ? sessionsById.get(sessionId) : undefined;
    if (!session) return;
    for (const event of events) {
      if (event.kind === "network") appendNetworkEventWithDedup(session.events, event);
      else if (event.kind === "action") appendActionEventWithDedup(session.events, event);
      else appendEventWithRetentionPolicy(session.events, event);
    }
    schedulePersist();
  };

  const appendEventsToRecentBuffer = (tabId: number, events: DebuggerEvent[]) => {
    if (events.length === 0) return;
    const now = Date.now();
    const MAX_AGE_MS = 60_000;
    const MAX_COUNT = 250;
    const existing = recentEventsByTab.get(tabId) ?? [];
    const merged = [...existing, ...events].filter((e) => now - e.timestamp <= MAX_AGE_MS);
    recentEventsByTab.set(tabId, merged.length > MAX_COUNT ? merged.slice(-MAX_COUNT) : merged);
  };

  const consumeInstantReplay = (tabId: number, lookbackMs: number): DebuggerEvent[] => {
    const now = Date.now();
    return (recentEventsByTab.get(tabId) ?? []).filter((e) => now - e.timestamp <= lookbackMs);
  };

  return {
    async injectDebuggerScriptForTab(tabId) {
      await ensureLoaded();
      if (!tabToSession.has(tabId)) return;
      await injectDebuggerScriptIntoTab(tabId);
    },

    async startSession(payload) {
      await ensureLoaded();
      const startedAt = Date.now();
      const sessionId = createSessionId();
      const lookbackMs =
        typeof payload.instantReplayLookbackMs === "number" && payload.instantReplayLookbackMs > 0
          ? Math.floor(payload.instantReplayLookbackMs)
          : 0;
      const session: StoredDebuggerSession = {
        sessionId,
        captureTabId: payload.captureTabId,
        captureType: payload.captureType,
        startedAt,
        recordingStartedAt: payload.captureType === "screenshot" ? startedAt : null,
        events: lookbackMs > 0 ? consumeInstantReplay(payload.captureTabId, lookbackMs) : [],
      };
      sessionsById.set(sessionId, session);
      tabToSession.set(payload.captureTabId, sessionId);
      schedulePersist();
      await injectDebuggerScriptIntoTab(payload.captureTabId);
      return { sessionId, startedAt };
    },

    async appendPageEvents(tabId, rawEvents) {
      await ensureLoaded();
      if (!Array.isArray(rawEvents) || rawEvents.length === 0) return;
      const normalized: DebuggerEvent[] = [];
      for (const raw of rawEvents) {
        const e = normalizeDebuggerEvent(raw);
        if (e) normalized.push(e);
      }
      appendEventsToRecentBuffer(tabId, normalized);
      appendEventsToSession(tabId, normalized);
    },

    async getSessionSnapshot(sessionId) {
      await ensureLoaded();
      const session = sessionsById.get(sessionId);
      if (!session) return null;
      return {
        sessionId: session.sessionId,
        captureTabId: session.captureTabId,
        captureType: session.captureType,
        startedAt: session.startedAt,
        recordingStartedAt: session.recordingStartedAt,
        events: session.events,
      };
    },

    async markSessionRecordingStarted({ sessionId, recordingStartedAt }) {
      await ensureLoaded();
      const session = sessionsById.get(sessionId);
      if (!session) return;
      session.recordingStartedAt = Math.floor(recordingStartedAt);
      schedulePersist();
    },

    async discardSession(sessionId) {
      await ensureLoaded();
      const session = sessionsById.get(sessionId);
      removeSession(sessionId);
      if (session) recentEventsByTab.delete(session.captureTabId);
      schedulePersist();
    },

    async ensureDebuggerScriptForTab(tabId, url) {
      await ensureLoaded();
      if (!url || !isInjectablePageUrl(url)) return;
      if (!tabToSession.has(tabId)) return;
      await injectDebuggerScriptIntoTab(tabId);
    },

    async discardSessionByTabId(tabId) {
      await ensureLoaded();
      const sessionId = tabToSession.get(tabId);
      if (!sessionId) return;
      removeSession(sessionId);
      recentEventsByTab.delete(tabId);
      schedulePersist();
    },
  };
}
