import type { ConsoleLevel, Reporter } from "./types";

interface UncaughtCaptureInput {
  reporter: Reporter;
  postConsole: (level: ConsoleLevel, args: unknown[]) => void;
}

export function installUncaughtExceptionCapture({
  reporter,
  postConsole,
}: UncaughtCaptureInput): void {
  window.addEventListener("error", (event) => {
    try {
      const msg =
        event.error instanceof Error
          ? `${event.error.name}: ${event.error.message}`
          : event.message || "Unknown error";
      postConsole("error", [`[uncaught] ${msg}`]);
    } catch (err) {
      reporter.reportNonFatalError("Failed to capture uncaught exception", err);
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event.reason;
      const msg =
        reason instanceof Error
          ? `${reason.name}: ${reason.message}`
          : String(reason ?? "Unknown rejection");
      postConsole("error", [`[unhandled rejection] ${msg}`]);
    } catch (err) {
      reporter.reportNonFatalError("Failed to capture unhandled rejection", err);
    }
  });
}
