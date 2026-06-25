import {
  DISCARD_SESSION_MESSAGE,
  ENSURE_PAGE_RUNTIME_MESSAGE,
  GET_SESSION_SNAPSHOT_MESSAGE,
  MARK_RECORDING_STARTED_MESSAGE,
  PAGE_BRIDGE_SOURCE,
  PAGE_EVENTS_MESSAGE,
  PAGE_EVENT_MESSAGE,
  START_SESSION_MESSAGE,
} from "@/capture-core/debugger/constants";
import { isRecordLike } from "@/capture-core/debugger/normalize";
import type {
  DebuggerContentBridgePayload,
  DebuggerRuntimeMessage,
  DebuggerRuntimeResponse,
} from "@/capture-core/debugger/types";
import { reportNonFatalError } from "@/shared/lib/errors";

export function sendDebuggerMessage<TData>(message: DebuggerRuntimeMessage): Promise<TData> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: DebuggerRuntimeResponse<TData> | undefined) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) return reject(new Error(runtimeError.message));
      if (!response) return reject(new Error("Debugger service did not respond"));
      if (!response.ok) return reject(new Error(response.error));
      resolve(response.data);
    });
  });
}

export async function sendDebuggerPageEvents(rawEvents: unknown[]): Promise<void> {
  if (rawEvents.length === 0) return;
  try {
    await sendDebuggerMessage<undefined>({
      type: PAGE_EVENTS_MESSAGE,
      payload: { events: rawEvents },
    });
  } catch (error) {
    if (isExpectedRuntimeDisconnectError(error)) return;
    reportNonFatalError("Failed to send debugger page events", error);
  }
}

export async function ensureDebuggerPageRuntime(): Promise<void> {
  try {
    await sendDebuggerMessage<undefined>({ type: ENSURE_PAGE_RUNTIME_MESSAGE, payload: {} });
  } catch (error) {
    if (isExpectedRuntimeDisconnectError(error)) return;
    reportNonFatalError("Failed to ensure debugger page runtime", error);
  }
}

export function isDebuggerRuntimeMessage(value: unknown): value is DebuggerRuntimeMessage {
  if (!isRecordLike(value)) return false;
  const t = value.type;
  if (typeof t !== "string") return false;
  return [
    START_SESSION_MESSAGE,
    MARK_RECORDING_STARTED_MESSAGE,
    GET_SESSION_SNAPSHOT_MESSAGE,
    DISCARD_SESSION_MESSAGE,
    PAGE_EVENT_MESSAGE,
    PAGE_EVENTS_MESSAGE,
    ENSURE_PAGE_RUNTIME_MESSAGE,
  ].includes(t);
}

export function isDebuggerContentBridgePayload(
  value: unknown
): value is DebuggerContentBridgePayload {
  if (!isRecordLike(value)) return false;
  if (value.source !== PAGE_BRIDGE_SOURCE) return false;
  return Object.hasOwn(value, "event") || Array.isArray(value.events);
}

function isExpectedRuntimeDisconnectError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("extension context invalidated") || msg.includes("receiving end does not exist")
  );
}
