import {
  BACKGROUND_LISTENER_FLAG,
  DISCARD_SESSION_MESSAGE,
  ENSURE_PAGE_RUNTIME_MESSAGE,
  GET_SESSION_SNAPSHOT_MESSAGE,
  MARK_RECORDING_STARTED_MESSAGE,
  PAGE_EVENTS_MESSAGE,
  PAGE_EVENT_MESSAGE,
  START_SESSION_MESSAGE,
} from "@/capture-core/debugger/constants";
import type { DebuggerRuntimeResponse } from "@/capture-core/debugger/types";
import { reportNonFatalError } from "@/shared/lib/errors";
import { isDebuggerRuntimeMessage } from "../../messaging";
import { createDebuggerSessionStore } from "./session-store";

interface BridgeCaptureConfig {
  fullSelectorPath?: boolean;
  performance?: boolean;
}

export interface DebuggerBridge {
  startSession(
    tabId: number,
    captureConfig?: BridgeCaptureConfig
  ): Promise<{ sessionId: string; startedAt: number }>;
  discardSession(sessionId: string): Promise<void>;
}

// Called with raw event objects after they've been appended to the store.
// Used by background.ts to keep the app-level SessionCounts in sync.
type RawEventsCallback = (tabId: number, events: unknown[]) => void;

export function registerDebuggerBackgroundListeners(
  onRawEvents?: RawEventsCallback,
  shouldPreserveTab?: (tabId: number) => boolean
): DebuggerBridge {
  const scope = globalThis as typeof globalThis & { [BACKGROUND_LISTENER_FLAG]?: boolean };
  if (scope[BACKGROUND_LISTENER_FLAG]) {
    // Already registered — return a no-op bridge (shouldn't happen in practice)
    return {
      startSession: async () => ({ sessionId: "", startedAt: Date.now() }),
      discardSession: async () => {},
    };
  }
  scope[BACKGROUND_LISTENER_FLAG] = true;

  const store = createDebuggerSessionStore();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isDebuggerRuntimeMessage(message)) return; // not ours

    const reply = <T>(r: DebuggerRuntimeResponse<T>) => sendResponse(r);
    const tabId = sender.tab?.id;

    const handle = async () => {
      switch (message.type) {
        case START_SESSION_MESSAGE:
          reply({ ok: true, data: await store.startSession(message.payload) });
          break;
        case MARK_RECORDING_STARTED_MESSAGE:
          await store.markSessionRecordingStarted(message.payload);
          reply({ ok: true, data: undefined });
          break;
        case PAGE_EVENT_MESSAGE:
          if (typeof tabId === "number") {
            await store.appendPageEvents(tabId, [message.payload.event]);
            onRawEvents?.(tabId, [message.payload.event]);
          }
          reply({ ok: true, data: undefined });
          break;
        case PAGE_EVENTS_MESSAGE:
          if (typeof tabId === "number") {
            await store.appendPageEvents(tabId, message.payload.events);
            onRawEvents?.(tabId, message.payload.events);
          }
          reply({ ok: true, data: undefined });
          break;
        case ENSURE_PAGE_RUNTIME_MESSAGE:
          if (typeof tabId === "number") await store.injectDebuggerScriptForTab(tabId);
          reply({ ok: true, data: undefined });
          break;
        case GET_SESSION_SNAPSHOT_MESSAGE:
          reply({ ok: true, data: await store.getSessionSnapshot(message.payload.sessionId) });
          break;
        case DISCARD_SESSION_MESSAGE:
          await store.discardSession(message.payload.sessionId);
          reply({ ok: true, data: undefined });
          break;
        default:
          reply({ ok: true, data: undefined });
      }
    };

    handle().catch((err: unknown) => {
      reportNonFatalError("Debugger background handler failed", err);
      reply({ ok: false, error: err instanceof Error ? err.message : "Handler failed" });
    });

    return true; // keep channel open
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!(changeInfo.status === "loading" || typeof changeInfo.url === "string")) return;
    const url = typeof changeInfo.url === "string" ? changeInfo.url : tab.url;
    store
      .ensureDebuggerScriptForTab(tabId, url)
      .catch((err: unknown) =>
        reportNonFatalError(`Failed to reinject debugger on tab update ${tabId}`, err)
      );
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    // Skip automatic discard when background.ts is handling this tab's session
    // (e.g. opening the recorder after the session tab closes unexpectedly).
    if (shouldPreserveTab?.(tabId)) return;
    store
      .discardSessionByTabId(tabId)
      .catch((err: unknown) =>
        reportNonFatalError(`Failed to discard debugger session for tab ${tabId}`, err)
      );
  });

  return {
    startSession: async (tabId, captureConfig?) => {
      if (chrome.scripting?.executeScript) {
        const config = {
          fullSelectorPath: captureConfig?.fullSelectorPath ?? true,
          performance: captureConfig?.performance ?? false,
        };
        await chrome.scripting
          .executeScript({
            target: { tabId },
            world: "MAIN",
            func: (cfg: typeof config) => {
              (
                window as Window & { __recorderCaptureConfig?: typeof cfg }
              ).__recorderCaptureConfig = cfg;
            },
            args: [config],
          })
          .catch(() => {});
      }
      return store.startSession({ captureTabId: tabId, captureType: "screenshot" });
    },
    discardSession: (sessionId) => store.discardSession(sessionId),
  };
}
