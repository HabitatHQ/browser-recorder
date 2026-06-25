import { installActionAndNavigationCapture } from "./actions";
import { installConsoleCapture } from "./console";
import { INSTALL_FLAG } from "./constants";
import { createPageDiagnostics } from "./diagnostics";
import { createEventQueue } from "./event-queue";
import { type SSEPayload, type WebSocketPayload, installNetworkCapture } from "./network";
import { type PerformancePayload, installPerformanceCapture } from "./performance";
import { createStringifyValue } from "./serializer";
import type { ConsoleLevel } from "./types";
import { installUncaughtExceptionCapture } from "./uncaught";
import { createNonFatalReporter, truncate } from "./utils";

interface PageRuntimeConfig {
  fullSelectorPath?: boolean;
  /** Capture Web Vitals / long tasks / resource timing / memory / fps (beta). */
  performance?: boolean;
}

export function installDebuggerPageRuntime(config: PageRuntimeConfig = {}): void {
  const scope = window as Window & {
    [INSTALL_FLAG]?: boolean;
  };

  if (scope[INSTALL_FLAG]) {
    return;
  }

  scope[INSTALL_FLAG] = true;

  const diagnostics = createPageDiagnostics(window);
  const reporter = diagnostics.createReporter(createNonFatalReporter());
  const { enqueueEvent, flushEventQueue } = createEventQueue({
    recordQueuedEvent: diagnostics.recordQueuedEvent,
    recordFlushedBatch: diagnostics.recordFlushedBatch,
  });
  const stringifyValue = createStringifyValue(reporter);

  const postAction = (
    actionType: string,
    target: string | undefined,
    metadata?: Record<string, unknown>
  ) => {
    diagnostics.recordActionEvent();
    enqueueEvent({
      kind: "action",
      timestamp: Date.now(),
      actionType,
      target,
      metadata,
    });
  };

  const postConsole = (level: ConsoleLevel, args: unknown[]) => {
    diagnostics.recordConsoleEvent();
    const serializedArgs: string[] = [];
    for (const arg of args) {
      serializedArgs.push(stringifyValue(arg));
    }

    enqueueEvent({
      kind: "console",
      timestamp: Date.now(),
      level,
      message: truncate(serializedArgs.join(" ")),
      metadata: {
        argumentCount: args.length,
      },
    });
  };

  const postNetwork = (payload: {
    method: string;
    url: string;
    status?: number;
    duration?: number;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
    requestBody?: string;
    responseBody?: string;
  }) => {
    diagnostics.recordNetworkEvent(payload.url);
    enqueueEvent({ kind: "network", timestamp: Date.now(), ...payload });
  };

  const postWebSocket = (payload: WebSocketPayload) => {
    enqueueEvent({ kind: "websocket", timestamp: Date.now(), ...payload });
  };

  const postSSE = (payload: SSEPayload) => {
    enqueueEvent({ kind: "sse", timestamp: Date.now(), ...payload });
  };

  // Performance payloads carry their own (timeOrigin-derived) timestamp, so the
  // long task / vital lands on the timeline when it happened, not when it flushed.
  const postPerformance = (payload: PerformancePayload) => {
    enqueueEvent({ kind: "performance", ...payload });
  };

  installActionAndNavigationCapture({
    postAction,
    fullSelectorPath: config.fullSelectorPath ?? true,
  });

  installConsoleCapture({ reporter, postConsole });
  installUncaughtExceptionCapture({ reporter, postConsole });

  try {
    installNetworkCapture({ diagnostics, reporter, postNetwork }, { postWebSocket, postSSE });
  } catch (error) {
    reporter.reportNonFatalError("Failed to install network capture in debugger runtime", error);
  }

  if (config.performance) {
    try {
      installPerformanceCapture({ reporter, postPerformance });
    } catch (error) {
      reporter.reportNonFatalError(
        "Failed to install performance capture in debugger runtime",
        error
      );
    }
  }

  const flushOnPageHide = () => {
    flushEventQueue();
  };

  window.addEventListener("pagehide", flushOnPageHide, {
    capture: true,
  });

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") {
        flushEventQueue();
      }
    },
    {
      capture: true,
      passive: true,
    }
  );
}
