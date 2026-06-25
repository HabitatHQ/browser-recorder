import { errToString } from "@/lib/diagnostics";

// Extension-wide error ring buffer. Distinct from diagnostics.ts, which tracks
// per-session capture health in `chrome.storage.session` and is wiped every time
// a session starts. This log lives in `chrome.storage.local` so it survives
// service-worker restarts and session resets, giving the "Report a bug" flow a
// record of what actually went wrong recently — not just the current state.
//
// Like diagnostics, the mutable singleton below is only meaningful in the
// background context (where the error sink is installed). Other contexts read a
// snapshot over messaging (`get-error-log`).

export interface ExtensionError {
  context: string;
  message: string;
  stack: string | null;
  at: number;
}

const MAX_ERRORS = 50;
const PERSIST_DEBOUNCE_MS = 400;
const STORAGE_KEY = "errorLog";

let log: ExtensionError[] = [];
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void chrome.storage.local.set({ [STORAGE_KEY]: log });
  }, PERSIST_DEBOUNCE_MS);
}

/** Load the persisted ring on background startup (survives SW restarts). */
export async function loadErrorLog(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const saved = result[STORAGE_KEY];
    if (Array.isArray(saved)) log = saved as ExtensionError[];
  } catch {
    // local storage unavailable
  }
}

/** Append an internal error. Wired into the error sink alongside diagnostics. */
export function logExtensionError(context: string, error: unknown): void {
  log.push({
    context,
    message: errToString(error),
    stack: error instanceof Error ? (error.stack ?? null) : null,
    at: Date.now(),
  });
  if (log.length > MAX_ERRORS) log.shift();
  persist();
}

export function getErrorLog(): ExtensionError[] {
  return log;
}

export async function clearErrorLog(): Promise<void> {
  log = [];
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: log });
  } catch {
    // local storage unavailable
  }
}
