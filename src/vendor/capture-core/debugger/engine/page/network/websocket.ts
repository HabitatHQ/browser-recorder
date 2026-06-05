import { MAX_BODY_LENGTH } from "../constants";
import type { Reporter } from "../types";
import { toAbsoluteUrl, truncate } from "../utils";

export interface WebSocketPayload {
  url: string;
  event: "open" | "close" | "error" | "send" | "message";
  data?: string;
  code?: number;
  reason?: string;
}

interface WebSocketCaptureInput {
  reporter: Reporter;
  postWebSocket: (payload: WebSocketPayload) => void;
}

function previewData(data: unknown): string | undefined {
  if (data === null || data === undefined) return undefined;
  if (typeof data === "string") return truncate(data, MAX_BODY_LENGTH);
  if (data instanceof ArrayBuffer) return `[Binary: ${data.byteLength} bytes]`;
  if (data instanceof Blob) return `[Blob: ${data.size} bytes]`;
  if (ArrayBuffer.isView(data))
    return `[Binary: ${(data as ArrayBufferView).byteLength} bytes]`;
  return undefined;
}

export function installWebSocketCapture({ reporter, postWebSocket }: WebSocketCaptureInput): void {
  if (!("WebSocket" in window)) return;

  const Original = window.WebSocket;

  window.WebSocket = new Proxy(Original, {
    construct(Target, args: ConstructorParameters<typeof WebSocket>) {
      const ws = new Target(...args);
      const url = toAbsoluteUrl(String(args[0] ?? ""), reporter) ?? String(args[0] ?? "");

      ws.addEventListener("open", () => postWebSocket({ url, event: "open" }));
      ws.addEventListener("error", () => postWebSocket({ url, event: "error" }));
      ws.addEventListener("close", (e: CloseEvent) =>
        postWebSocket({ url, event: "close", code: e.code, reason: e.reason || undefined })
      );
      ws.addEventListener("message", (e: MessageEvent) =>
        postWebSocket({ url, event: "message", data: previewData(e.data) })
      );

      const originalSend = ws.send.bind(ws);
      Object.defineProperty(ws, "send", {
        value(data: Parameters<WebSocket["send"]>[0]) {
          postWebSocket({ url, event: "send", data: previewData(data) });
          return originalSend(data);
        },
        writable: true,
        configurable: true,
      });

      return ws;
    },
  }) as typeof WebSocket;
}
