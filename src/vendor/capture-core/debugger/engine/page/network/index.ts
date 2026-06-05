import { installFetchCapture } from "./fetch/install";
import { installSSECapture, type SSEPayload } from "./sse";
import type { NetworkCaptureInput } from "./types";
import { installWebSocketCapture, type WebSocketPayload } from "./websocket";
import { installXhrCapture } from "./xhr";

export type { SSEPayload, WebSocketPayload };

export interface NetworkCaptureExtras {
  postWebSocket: (payload: WebSocketPayload) => void;
  postSSE: (payload: SSEPayload) => void;
}

export function installNetworkCapture(
  input: NetworkCaptureInput,
  extras: NetworkCaptureExtras
): void {
  installFetchCapture(input);
  installXhrCapture(input);
  installWebSocketCapture({ reporter: input.reporter, postWebSocket: extras.postWebSocket });
  installSSECapture({ reporter: input.reporter, postSSE: extras.postSSE });
}
