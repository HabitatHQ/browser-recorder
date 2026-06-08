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
}

export type DebuggerEvent =
  | DebuggerActionEvent
  | DebuggerConsoleEvent
  | DebuggerNetworkEvent;

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
}
