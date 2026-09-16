import type { PageDiagnostics } from "../diagnostics";
import type { Reporter } from "../types";
import type { NetworkCapturePolicy } from "./policy";

export interface PostNetworkPayload {
  method: string;
  url: string;
  status?: number;
  duration?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
}

export interface NetworkCaptureInput {
  reporter: Reporter;
  diagnostics: Pick<
    PageDiagnostics,
    | "recordFetchCall"
    | "recordFetchFailure"
    | "setFetchHookState"
    | "recordXhrCall"
    | "setXhrHookInstalled"
  >;
  policy: NetworkCapturePolicy;
  postNetwork: (payload: PostNetworkPayload) => void;
}
