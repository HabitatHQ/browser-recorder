export type DebuggerActionType = "click" | "input" | "change" | "submit" | "keydown" | "navigation";

export interface DebuggerActionEvent {
  kind: "action";
  timestamp: number;
  actionType: DebuggerActionType | string;
  target?: string;
  metadata?: Record<string, unknown>;
}

export interface DebuggerConsoleEvent {
  kind: "console";
  timestamp: number;
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface DebuggerNetworkEvent {
  kind: "network";
  timestamp: number;
  method: string;
  url: string;
  status?: number;
  duration?: number;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  /**
   * Set when the submitter dropped this request during review. Headers and
   * bodies are stripped; method/url/status/timestamp are kept as a tombstone so
   * the reviewer knows the request existed and was deliberately removed.
   */
  dropped?: boolean;
}

export interface DebuggerWebSocketEvent {
  kind: "websocket";
  timestamp: number;
  url: string;
  event: "open" | "close" | "error" | "send" | "message";
  data?: string;
  code?: number;
  reason?: string;
}

export interface DebuggerSSEEvent {
  kind: "sse";
  timestamp: number;
  url: string;
  event: "open" | "error" | "message";
  data?: string;
  eventType?: string;
  lastEventId?: string;
}

export type DebuggerEvent =
  | DebuggerActionEvent
  | DebuggerConsoleEvent
  | DebuggerNetworkEvent
  | DebuggerWebSocketEvent
  | DebuggerSSEEvent;

export interface SubmitFormValues {
  title: string;
  description: string;
  notes: string;
}

export interface ReportInput {
  title: string;
  description: string;
  notes: string;
  url?: string | null;
  startedAt: number | null; // unix ms, used for time offsets
  consoleEvents: DebuggerConsoleEvent[];
  networkEvents: DebuggerNetworkEvent[];
  interactions: DebuggerActionEvent[];
  /** Count of (event, field) pairs the submitter redacted during review. */
  redactedFieldCount?: number;
}
