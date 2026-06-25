const reportedContexts = new Set<string>();

// Optional sink so a context (e.g. the background) can route every non-fatal
// error into the diagnostics store, not just the console. Page/content contexts
// leave it unset and keep console-only behavior.
type ErrorSink = (context: string, error: unknown) => void;
let errorSink: ErrorSink | null = null;

export function setErrorSink(sink: ErrorSink | null): void {
  errorSink = sink;
}

export function reportNonFatalError(
  context: string,
  error: unknown,
  options?: { once?: boolean }
): void {
  if (options?.once) {
    if (reportedContexts.has(context)) return;
    reportedContexts.add(context);
  }
  console.warn(`[Non-fatal] ${context}`, error);
  try {
    errorSink?.(context, error);
  } catch {
    // a broken sink must never break error reporting
  }
}

export function isErrorWithCode(error: unknown, code: string): error is Error & { code?: unknown } {
  return error instanceof Error && "code" in error && (error as { code?: unknown }).code === code;
}
