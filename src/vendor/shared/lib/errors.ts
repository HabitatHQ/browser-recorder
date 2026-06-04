const reportedContexts = new Set<string>();

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
}

export function isErrorWithCode(error: unknown, code: string): error is Error & { code?: unknown } {
  return error instanceof Error && "code" in error && (error as { code?: unknown }).code === code;
}
