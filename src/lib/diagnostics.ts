import type { CaptureConfig, SessionCounts } from "@/lib/types";

// Capture-health diagnostics. The background owns a single in-memory store and
// every feature reports its pipeline health (a feature has named stages, each
// with an ok flag, a running count, and the last error). The recorder reads the
// store via the `get-diagnostics` message and renders it; every export bundles
// a diagnostics.json. The point is that a capture that produces nothing is
// *explained* (e.g. "replay: inject ok, stream never fired") instead of failing
// silently into a console nobody reads.

export interface StageHealth {
  /** true = succeeded, false = failed, null = expected but not yet observed. */
  ok: boolean | null;
  /** Items/bytes processed through this stage. */
  count: number;
  lastError: string | null;
  at: number | null;
}

export interface DiagnosticsError {
  context: string;
  message: string;
  at: number;
}

export interface Diagnostics {
  sessionId: string | null;
  startedAt: number | null;
  features: Record<string, Record<string, StageHealth>>;
  errors: DiagnosticsError[];
}

export interface DiagnosticsFinding {
  level: "ok" | "warn" | "error";
  feature: string;
  message: string;
}

const MAX_ERRORS = 50;
const PERSIST_DEBOUNCE_MS = 400;
const STORAGE_KEY = "diagnostics";

export function emptyDiagnostics(): Diagnostics {
  return { sessionId: null, startedAt: null, features: {}, errors: [] };
}

export function errToString(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// ─── Background-owned singleton ───────────────────────────────────────────────
// Mutable state below is only meaningful in the background context. Other
// contexts (recorder) consume a snapshot fetched over messaging.

let store = emptyDiagnostics();
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void chrome.storage.session.set({ [STORAGE_KEY]: store });
  }, PERSIST_DEBOUNCE_MS);
}

function stageOf(feature: string, stage: string): StageHealth {
  const feat = store.features[feature] ?? {};
  store.features[feature] = feat;
  const existing = feat[stage];
  if (existing) return existing;
  const created: StageHealth = { ok: null, count: 0, lastError: null, at: null };
  feat[stage] = created;
  return created;
}

/** Begin a fresh diagnostics record for a session (or null for standalone). */
export function resetDiagnostics(sessionId: string | null): void {
  store = emptyDiagnostics();
  store.sessionId = sessionId;
  store.startedAt = Date.now();
  persist();
}

/** Declare a stage as expected (ok: null) so the panel shows it even pre-event. */
export function expectStage(feature: string, stage: string): void {
  stageOf(feature, stage);
  persist();
}

export function markStageOk(feature: string, stage: string): void {
  const s = stageOf(feature, stage);
  s.ok = true;
  s.at = Date.now();
  persist();
}

export function bumpStage(feature: string, stage: string, by = 1): void {
  const s = stageOf(feature, stage);
  s.count += by;
  s.at = Date.now();
  if (s.ok === null) s.ok = true;
  persist();
}

export function failStage(feature: string, stage: string, error: unknown): void {
  const s = stageOf(feature, stage);
  s.ok = false;
  s.lastError = errToString(error);
  s.at = Date.now();
  persist();
}

export function recordDiagnosticError(context: string, error: unknown): void {
  store.errors.push({ context, message: errToString(error), at: Date.now() });
  if (store.errors.length > MAX_ERRORS) store.errors.shift();
  persist();
}

export function getDiagnostics(): Diagnostics {
  return store;
}

/** Load any persisted diagnostics (e.g. after a service-worker restart mid-session). */
export async function loadDiagnostics(): Promise<void> {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEY);
    const saved = result[STORAGE_KEY] as Diagnostics | undefined;
    if (saved) store = saved;
  } catch {
    // session storage unavailable
  }
}

/** Write the current store immediately (call before the recorder reads it). */
export async function flushDiagnostics(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: store });
  } catch {
    // session storage unavailable
  }
}

// ─── Invariants (expected vs actual) ──────────────────────────────────────────
// Pure — usable in any context. Turns "enabled but produced nothing" into a
// visible warning, which is the whole anti-silent-failure point.

export function summarizeDiagnostics(
  captureConfig: CaptureConfig | null,
  counts: SessionCounts,
  diagnostics: Diagnostics | null
): DiagnosticsFinding[] {
  const findings: DiagnosticsFinding[] = [];
  const feature = (name: string) => diagnostics?.features[name] ?? {};

  if (captureConfig?.replay) {
    const r = feature("replay");
    if (r.inject?.ok === false) {
      findings.push({
        level: "error",
        feature: "replay",
        message: `injection failed: ${r.inject.lastError}`,
      });
    } else if ((r.stream?.count ?? 0) === 0) {
      findings.push({
        level: "warn",
        feature: "replay",
        message:
          r.inject?.ok === true
            ? "injected, but no events were captured (rrweb recording or page→background bridge)"
            : "never injected into the page",
      });
    } else if (r.write?.ok === false) {
      findings.push({
        level: "error",
        feature: "replay",
        message: `events captured but OPFS write failed: ${r.write.lastError}`,
      });
    } else {
      findings.push({
        level: "ok",
        feature: "replay",
        message: `${r.stream?.count ?? 0} events captured`,
      });
    }
  }

  if (captureConfig?.video) {
    const v = feature("video");
    if (v.start?.ok === false || v.write?.ok === false) {
      findings.push({
        level: "error",
        feature: "video",
        message: v.start?.lastError ?? v.write?.lastError ?? "video capture failed",
      });
    } else if ((v.write?.count ?? 0) === 0) {
      findings.push({
        level: "warn",
        feature: "video",
        message: "enabled, but no video was written",
      });
    }
  }

  if (captureConfig?.console && counts.console === 0) {
    findings.push({
      level: "warn",
      feature: "console",
      message: "enabled, but no console output captured",
    });
  }
  if (captureConfig?.network && counts.network === 0) {
    findings.push({
      level: "warn",
      feature: "network",
      message: "enabled, but no network requests captured",
    });
  }
  if (captureConfig?.interactions && counts.interactions === 0) {
    findings.push({
      level: "warn",
      feature: "interactions",
      message: "enabled, but no interactions captured",
    });
  }

  const errorCount = diagnostics?.errors.length ?? 0;
  if (errorCount > 0) {
    findings.push({
      level: "warn",
      feature: "errors",
      message: `${errorCount} non-fatal error(s) recorded`,
    });
  }

  return findings;
}
