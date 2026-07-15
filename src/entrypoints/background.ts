import {
  type DebuggerBridge,
  registerDebuggerBackgroundListeners,
} from "@/lib/bug-report-debugger/engine/background";
import { isDebuggerRuntimeMessage } from "@/lib/bug-report-debugger/messaging";
import {
  bumpStage,
  expectStage,
  failStage,
  flushDiagnostics,
  getDiagnostics,
  loadDiagnostics,
  markStageOk,
  recordDiagnosticError,
  resetDiagnostics,
} from "@/lib/diagnostics";
import { clearErrorLog, getErrorLog, loadErrorLog, logExtensionError } from "@/lib/error-log";
import { slugify, toFilenameTimestamp } from "@/lib/export";
import { fail, ok } from "@/lib/messaging";
import { appendBytesToOpfs, writeToOpfs } from "@/lib/opfs";
import { injectReplayRecorderIntoTab, stopReplayInTab } from "@/lib/replay";
import { isReplayEventsMessage } from "@/lib/replay-messaging";
import { type RingEligibility, evaluateRingScope, hostFromUrl } from "@/lib/ring/scope";
import {
  OPFS_PREFIX,
  addRingPin,
  appendStandaloneDomSnapshotFilename,
  appendStandaloneScreenshotFilename,
  debuggerEventsOpfsFilename,
  domSnapshotOpfsFilename,
  getCounts,
  getLocalBackupSession,
  getRingConfig,
  getRingPins,
  getSession,
  getSettings,
  getStandaloneDomSnapshotFilenames,
  getStandaloneScreenshotFilenames,
  removeRingPin,
  replayOpfsFilename,
  saveCounts,
  saveRingConfig,
  saveSettings,
  screenshotOpfsFilename,
  setRingSnapshot,
  setSession,
  standaloneDomSnapshotOpfsFilename,
  standaloneScreenshotOpfsFilename,
} from "@/lib/storage";
import {
  type BgMessage,
  DEFAULT_RING_CONFIG,
  type RingConfig,
  type RingScopeReason,
  type RingSnapshot,
  type RingStatus,
  type RingTabInfo,
  type Session,
  type SessionCounts,
} from "@/lib/types";
import { reportNonFatalError, setErrorSink } from "@/shared/lib/errors";

// ─── Timing constants ────────────────────────────────────────────────────────

const INTERACTION_CAPTURE_DEBOUNCE_MS = 1500;
const COUNT_PERSIST_DEBOUNCE_MS = 500;
// Popup needs ~300 ms to close before tab screenshot is taken
const SCREENSHOT_POPUP_DISMISS_MS = 300;
// Give MediaRecorder.onstop time to flush before closing the offscreen document
const VIDEO_STOP_GRACE_MS = 500;

// ─── In-memory authoritative state ──────────────────────────────────────────
// Background is the single owner of session and counts. Storage is a
// write-through cache for crash recovery; UIs always query the background.

let debuggerBridge: DebuggerBridge;
let bgSession: Session | null = null;
let bgCounts: SessionCounts = emptyCounts();
let recorderTabId: number | null = null;
let sessionFromCrashRecovery = false;

// ─── Firefox video capture state ─────────────────────────────────────────────
// On Firefox, tabCapture/offscreen are unavailable. A dedicated extension tab
// calls getDisplayMedia, records to OPFS, and signals when done.
let firefoxVideoTabId: number | null = null;
// Resolved when fx-video-done arrives (or the tab closes); lets stop-session
// await finalization before opening the report recorder.
let firefoxVideoDoneResolve: (() => void) | null = null;
let firefoxVideoDonePromise: Promise<void> = Promise.resolve();

function emptyCounts(): SessionCounts {
  return {
    console: 0,
    network: 0,
    interactions: 0,
    websocket: 0,
    sse: 0,
    domSnapshots: 0,
    screenshots: 0,
    errors: 0,
  };
}

// ─── Ring state ───────────────────────────────────────────────────────────────

interface TimestampedEvent {
  timestamp: number;
  event: unknown;
}
interface RingVideoChunk {
  bytes: Uint8Array;
  timestamp: number;
  mimeType: string;
}

let ringConfig: RingConfig = DEFAULT_RING_CONFIG;
// `ringEnabled` is the feature toggle (survives across tab switches and SW
// restarts); `ringActive` means a tab is streaming data in right now. The ring
// can be enabled but inactive when the focused tab is out of scope.
let ringEnabled = false;
let ringReason: RingScopeReason | null = null;
let ringPins: string[] = [];
// True while an explicit recording session has suspended the ring (they share a
// single video stream). Resumed automatically when the session ends.
let ringPausedForSession = false;
let ringActive = false;
let ringTabId: number | null = null;
let ringTabUrl: string | undefined;
let ringTabTitle: string | undefined;
let ringDebuggerSessionId: string | null = null;
let ringVideoActive = false;
// Per-tab retained buffers. When the user switches away, the old tab's data is
// kept here (and merged on export) until it ages out of the window; only the
// currently focused tab actively streams new events in. Video is the exception —
// it belongs to the recording tab only and is not retained (ringVideoChunks).
interface RingTabBuffer {
  tabId: number;
  url: string | undefined;
  title: string | undefined;
  host: string | null;
  console: TimestampedEvent[];
  network: TimestampedEvent[];
  interactions: TimestampedEvent[];
  performance: TimestampedEvent[];
  lastActiveMs: number;
}
// Cap on retained tabs so the window can't grow without bound; pinned sites are
// evicted last.
const MAX_RETAINED_TABS = 8;
const ringBuffers = new Map<number, RingTabBuffer>();
let ringVideoChunks: RingVideoChunk[] = [];

function ringBufferSize(buf: RingTabBuffer): number {
  return buf.console.length + buf.network.length + buf.interactions.length + buf.performance.length;
}

// Get-or-create the buffer for a tab and mark it freshly active. Evicts the
// oldest non-pinned retained buffer when over the cap.
function ensureRingBuffer(
  tabId: number,
  url: string | undefined,
  title: string | undefined
): RingTabBuffer {
  let buf = ringBuffers.get(tabId);
  if (buf) {
    buf.url = url;
    buf.title = title;
    buf.host = hostFromUrl(url);
    buf.lastActiveMs = Date.now();
  } else {
    buf = {
      tabId,
      url,
      title,
      host: hostFromUrl(url),
      console: [],
      network: [],
      interactions: [],
      performance: [],
      lastActiveMs: Date.now(),
    };
    ringBuffers.set(tabId, buf);
  }
  evictRingBuffersIfNeeded(tabId);
  return buf;
}

function evictRingBuffersIfNeeded(keepTabId: number): void {
  if (ringBuffers.size <= MAX_RETAINED_TABS) return;
  const candidates = [...ringBuffers.values()].filter((b) => b.tabId !== keepTabId);
  const nonPinned = candidates.filter((b) => b.host === null || !ringPins.includes(b.host));
  const pool = (nonPinned.length > 0 ? nonPinned : candidates).sort(
    (a, b) => a.lastActiveMs - b.lastActiveMs
  );
  let i = 0;
  while (ringBuffers.size > MAX_RETAINED_TABS && i < pool.length) {
    ringBuffers.delete(pool[i].tabId);
    i++;
  }
}

async function initState(): Promise<void> {
  bgSession = await getSession();
  if (!bgSession) {
    // chrome.storage.session was cleared — check for a crash-safe backup in
    // chrome.storage.local. If one exists the previous session was interrupted
    // by a crash (a clean stop/discard always clears both stores).
    const backup = await getLocalBackupSession();
    if (backup) {
      bgSession = backup;
      sessionFromCrashRecovery = true;
    }
  }
  bgCounts = await getCounts();
  ringConfig = await getRingConfig();
  ringPins = await getRingPins();
  ringEnabled = ringConfig.enabled;
  await loadDiagnostics();
  await loadErrorLog();
  // Route every reportNonFatalError in this context into the per-session
  // diagnostics store AND the persistent extension-wide error log (the latter
  // backs the "Report a bug" flow and survives session resets / SW restarts).
  setErrorSink((context, error) => {
    recordDiagnosticError(context, error);
    logExtensionError(context, error);
  });
}

function persistSession(): Promise<void> {
  return setSession(bgSession);
}

// Batch count writes — counts can change at high frequency during recording
let countsPersistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersistCounts(): void {
  if (countsPersistTimer) return;
  countsPersistTimer = setTimeout(() => {
    countsPersistTimer = null;
    void saveCounts(bgCounts);
  }, COUNT_PERSIST_DEBOUNCE_MS);
}

function bumpCount(field: keyof Omit<SessionCounts, "errors">, by = 1): void {
  bgCounts[field] += by;
  schedulePersistCounts();
}

// ─── Debounce timers ─────────────────────────────────────────────────────────

let autoSsTimer: ReturnType<typeof setTimeout> | null = null;
let autoDomTimer: ReturnType<typeof setTimeout> | null = null;

function clearAutoCaptureTimers() {
  if (autoSsTimer) {
    clearTimeout(autoSsTimer);
    autoSsTimer = null;
  }
  if (autoDomTimer) {
    clearTimeout(autoDomTimer);
    autoDomTimer = null;
  }
}

// ─── Debugger event streaming to OPFS ────────────────────────────────────────
// Every batch of raw events (console, network, interactions, websocket, sse)
// is appended to a per-session NDJSON file in OPFS. This makes events
// crash-resilient: they survive a browser crash even though the in-memory
// debugger store (and chrome.storage.session) do not.
let eventsWriteChain: Promise<void> = Promise.resolve();

function appendDebuggerEventsToOpfs(events: unknown[]): void {
  const session = bgSession;
  if (!session) return;

  // Assign the filename on the first write and persist so the recorder can
  // locate the file even after a crash (via the chrome.storage.local backup).
  const filename = debuggerEventsOpfsFilename(session.id);
  if (!session.eventsOpfsFilename) {
    session.eventsOpfsFilename = filename;
    void persistSession();
  }

  const ndjson = `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
  const bytes = new TextEncoder().encode(ndjson);
  eventsWriteChain = eventsWriteChain
    .then(() => appendBytesToOpfs(filename, bytes))
    .catch((err) => {
      reportNonFatalError("Failed to append events to OPFS", err);
    });
}

// ─── Replay event streaming ───────────────────────────────────────────────────
// Replay events stream in from the page bridge as batches. We append each batch
// to a per-session OPFS file as NDJSON, committing on every flush (writes go to
// the file's current end), so the recording survives both page reloads and a
// suspended service worker. Appends are serialized through a promise chain to
// avoid interleaved writes.
let replayWriteChain: Promise<void> = Promise.resolve();

function appendReplayEvents(events: unknown[], senderTabId: number | undefined): void {
  const session = bgSession;
  if (
    !session ||
    session.tabId !== senderTabId ||
    !session.captureConfig.replay ||
    session.status === "paused"
  ) {
    failStage(
      "replay",
      "stream",
      `events from tab ${senderTabId} rejected (session tab ${bgSession?.tabId ?? "none"}, replay ${bgSession?.captureConfig.replay ?? "off"}, status ${bgSession?.status ?? "none"})`
    );
    return;
  }
  if (events.length === 0) return;
  bumpStage("replay", "stream", events.length);
  // rrweb is only replayable if a FullSnapshot (type 2) is present; tally the
  // key event types so the diagnostics panel shows whether one was captured.
  let metaN = 0;
  let fullN = 0;
  for (const e of events) {
    const t = (e as { type?: number }).type;
    if (t === 4) metaN++;
    else if (t === 2) fullN++;
  }
  if (metaN > 0) bumpStage("replay", "meta", metaN);
  if (fullN > 0) bumpStage("replay", "fullSnapshot", fullN);

  const filename = replayOpfsFilename(session.id);
  if (!session.replayOpfsFilename) {
    session.replayOpfsFilename = filename;
    void persistSession();
  }

  const ndjson = `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
  const bytes = new TextEncoder().encode(ndjson);
  replayWriteChain = replayWriteChain
    .then(async () => {
      await appendBytesToOpfs(filename, bytes);
      bumpStage("replay", "write", bytes.byteLength);
    })
    .catch((err) => {
      failStage("replay", "write", err);
      reportNonFatalError("Failed to append replay events", err);
    });
}

// ─── Offscreen message types ─────────────────────────────────────────────────

type OffscreenMsg =
  | { type: "offscreen-ready" }
  | { type: "offscreen-recording-done"; filename: string; totalBytes: number }
  | { type: "offscreen-size-warning"; megabytes: number }
  | { type: "offscreen-error"; message: string }
  | { type: "offscreen-ring-chunk"; chunk: ArrayBuffer; mimeType: string }
  | { type: "offscreen-ring-stopped" };

function isOffscreenMessage(msg: unknown): msg is OffscreenMsg {
  if (typeof msg !== "object" || msg === null || !("type" in msg)) return false;
  const t = (msg as { type: unknown }).type;
  return typeof t === "string" && t.startsWith("offscreen-");
}

// ─── Firefox video messages ───────────────────────────────────────────────────

type FxVideoMsg = { type: "fx-video-done"; filename: string };

function isFxVideoMessage(msg: unknown): msg is FxVideoMsg {
  return (
    typeof msg === "object" && msg !== null && (msg as { type?: unknown }).type === "fx-video-done"
  );
}

function handleFxVideoMessage(msg: FxVideoMsg): void {
  if (bgSession) {
    bgSession.videoOpfsFilename = msg.filename;
    void persistSession();
  }
  firefoxVideoDoneResolve?.();
  firefoxVideoDoneResolve = null;
  firefoxVideoTabId = null;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function initializeBackgroundState(): Promise<void> {
  await initState();

  // ── Crash recovery ──────────────────────────────────────────────────────────
  // If initState restored a session from the chrome.storage.local backup it
  // means chrome.storage.session was cleared (crash or restart). Check whether
  // the recording tab still exists: if it does, we just survived a service-
  // worker suspend/restart mid-session and can continue normally; if not, the
  // browser crashed during an active recording and we should offer recovery.
  if (sessionFromCrashRecovery && bgSession) {
    let tabStillExists = false;
    try {
      await chrome.tabs.get(bgSession.tabId);
      tabStillExists = true;
    } catch {
      // tab is gone
    }

    if (tabStillExists) {
      // SW was restarted but Chrome kept running — re-populate session storage.
      await setSession(bgSession);
    } else if (bgSession.status === "recording") {
      // Browser crashed during an active recording. Transition to stopping and
      // open the recorder so the user can export whatever was saved to OPFS.
      bgSession.status = "stopping";
      await eventsWriteChain; // no-op on fresh SW start, but ensures ordering
      await flushDiagnostics();
      await persistSession();
      chrome.action.setBadgeText({ text: "" });
      const recoverTab = await chrome.tabs.create({
        url: chrome.runtime.getURL(`/recorder.html?sessionId=${bgSession.id}`),
      });
      recorderTabId = recoverTab.id ?? null;
    } else {
      // Session was stopping when the crash occurred (recorder was already open)
      // or had no data worth recovering — discard silently.
      bgSession = null;
      await setSession(null);
    }
  }

  await sweepOrphanedOpfsFiles();

  // Resume the ring after a service-worker suspend/restart: if the feature is on,
  // re-evaluate the focused tab and start capturing if it's in scope. (Data
  // buffered before the suspend is not durable — see the product spec.)
  if (ringEnabled && !bgSession) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) await refocusRing(tab.id, tab.url);
    } catch {
      // no focused tab yet
    }
  }
}

// Resolves once initializeBackgroundState() has restored persisted state. Every
// listener below awaits this before touching that state, which lets the listeners
// be registered synchronously — a cold-started MV3 service worker must have its
// onMessage listener in place the instant it wakes, otherwise the very message
// that woke it fails in the sender with "Could not establish connection.
// Receiving end does not exist." (e.g. Save settings after the worker idled out).
let resolveBackgroundReady!: () => void;
const backgroundReady = new Promise<void>((resolve) => {
  resolveBackgroundReady = resolve;
});

export default defineBackground(() => {
  debuggerBridge = registerDebuggerBackgroundListeners(
    async (tabId, rawEvents) => {
      type RawEvent = { kind?: string; actionType?: string; metadata?: { mode?: string } };
      const events = rawEvents as RawEvent[];

      if (bgSession?.tabId === tabId && bgSession.status !== "paused") {
        let consoleN = 0;
        let networkN = 0;
        let interactionsN = 0;
        let websocketN = 0;
        let sseN = 0;
        let hasAutoTriggerAction = false;
        for (const e of events) {
          if (e.kind === "console") consoleN++;
          else if (e.kind === "network") networkN++;
          else if (e.kind === "websocket") websocketN++;
          else if (e.kind === "sse") sseN++;
          else if (e.kind === "action") {
            interactionsN++;
            if (
              e.actionType === "click" ||
              e.actionType === "change" ||
              (e.actionType === "navigation" && e.metadata?.mode !== "initial")
            ) {
              hasAutoTriggerAction = true;
            }
          }
        }
        if (consoleN > 0) bumpCount("console", consoleN);
        if (networkN > 0) bumpCount("network", networkN);
        if (websocketN > 0) bumpCount("websocket", websocketN);
        if (sseN > 0) bumpCount("sse", sseN);
        if (interactionsN > 0) bumpCount("interactions", interactionsN);
        if (events.length > 0) {
          bumpStage("debugger", "events", events.length);
          appendDebuggerEventsToOpfs(events);
        }

        if (hasAutoTriggerAction) {
          if (bgSession.captureConfig.autoScreenshotOnInteraction) {
            if (autoSsTimer) clearTimeout(autoSsTimer);
            autoSsTimer = setTimeout(() => {
              autoSsTimer = null;
              void captureAutoScreenshot(tabId);
            }, INTERACTION_CAPTURE_DEBOUNCE_MS);
          }

          if (bgSession.captureConfig.autoDomSnapshotOnInteraction) {
            if (autoDomTimer) clearTimeout(autoDomTimer);
            autoDomTimer = setTimeout(() => {
              autoDomTimer = null;
              void captureAutoDomSnapshot(tabId);
            }, INTERACTION_CAPTURE_DEBOUNCE_MS);
          }
        }
      } else if (ringActive && ringTabId === tabId) {
        pruneRingBuffer();
        const buf = ringBuffers.get(tabId);
        if (buf) {
          const now = Date.now();
          buf.lastActiveMs = now;
          for (const ev of events) {
            const timestamped = { timestamp: now, event: ev };
            if (ev.kind === "console") buf.console.push(timestamped);
            else if (ev.kind === "network" || ev.kind === "websocket" || ev.kind === "sse")
              buf.network.push(timestamped);
            else if (ev.kind === "action") buf.interactions.push(timestamped);
            else if (ev.kind === "performance") buf.performance.push(timestamped);
          }
        }
      }
    },
    (tabId) => bgSession?.tabId === tabId || (ringActive && ringTabId === tabId)
  );

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isDebuggerRuntimeMessage(message)) return;
    if (isReplayEventsMessage(message)) {
      void backgroundReady.then(() => appendReplayEvents(message.events, sender.tab?.id));
      return false;
    }
    if (isOffscreenMessage(message)) {
      void backgroundReady.then(() => handleOffscreenMessage(message));
      return false;
    }
    if (isFxVideoMessage(message)) {
      void backgroundReady.then(() => handleFxVideoMessage(message));
      return false;
    }
    backgroundReady
      .then(() => handleMessage(message as BgMessage))
      .then(sendResponse)
      .catch((err: unknown) => {
        reportNonFatalError("Background message handler failed", err);
        sendResponse(fail(err instanceof Error ? err.message : "Unknown error"));
      });
    return true;
  });

  chrome.commands.onCommand.addListener((command) => {
    backgroundReady
      .then(() => handleCommand(command))
      .catch((err: unknown) => reportNonFatalError(`Command ${command} failed`, err));
  });

  chrome.tabs.onRemoved.addListener(async (tabId) => {
    await backgroundReady;
    if (tabId === firefoxVideoTabId) {
      // User closed the video capture tab — treat as a clean stop.
      firefoxVideoTabId = null;
      firefoxVideoDoneResolve?.();
      firefoxVideoDoneResolve = null;
      return;
    }

    if (tabId === recorderTabId) {
      recorderTabId = null;
      if (bgSession?.debuggerSessionId) {
        await debuggerBridge.discardSession(bgSession.debuggerSessionId);
      }
      bgSession = null;
      bgCounts = emptyCounts();
      await setSession(null);
      return;
    }

    if (ringActive && ringTabId === tabId) {
      // The tab the ring was recording closed — stop capture. Its buffered data
      // is retained (and merged on export) until it ages out.
      await stopActiveRecording();
      ringReason = null;
    }

    if (bgSession?.tabId !== tabId) return;
    // Session tab closed — treat the same as stop-session so data isn't lost.
    // shouldPreserveTab prevents the debugger bridge from discarding the session
    // so the recorder can still read console/network/interaction events.
    clearAutoCaptureTimers();
    if (bgSession.captureConfig.video) await stopVideoCapture();
    bgSession.status = "stopping";
    await persistSession();
    await flushDiagnostics();
    chrome.action.setBadgeText({ text: "" });
    const recorderTab = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/recorder.html?sessionId=${bgSession.id}`),
    });
    recorderTabId = recorderTab.id ?? null;
    await resumeRingAfterSession();
  });

  // Re-inject the replay recorder after a navigation so recording resumes on the
  // new document. rrweb emits a fresh full snapshot, and the appended NDJSON
  // stream stays continuous across the reload.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === "complete") {
      void backgroundReady.then(() => {
        if (bgSession?.tabId !== tabId || bgSession.status !== "recording") return;
        if (!bgSession.captureConfig.replay) return;
        void injectReplayRecorderIntoTab(tabId);
      });
    }

    // Re-evaluate ring scope when the focused tab navigates. Navigating to a
    // blocked or out-of-scope URL must stop capture immediately; navigating an
    // in-scope tab to another in-scope URL keeps recording uninterrupted.
    if (changeInfo.url !== undefined || changeInfo.status === "complete") {
      void backgroundReady.then(async () => {
        if (!ringEnabled) return;
        try {
          const tab = await chrome.tabs.get(tabId);
          if (!tab.active) return;
          await refocusRing(tabId, changeInfo.url ?? tab.url);
        } catch {
          // tab gone
        }
      });
    }
  });

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    await backgroundReady;
    await refocusRing(tabId);
  });

  // Listeners are registered; now restore persisted state and open the gate so
  // queued events run. Runs after the synchronous registration above so a
  // freshly-woken worker can already receive the message that woke it.
  void initializeBackgroundState()
    .catch((err: unknown) => reportNonFatalError("Background initialization failed", err))
    .finally(() => resolveBackgroundReady());
});

// ─── Message handler ─────────────────────────────────────────────────────────

async function handleMessage(message: BgMessage) {
  switch (message.type) {
    case "get-session":
      return ok(bgSession);

    case "get-counts":
      return ok(bgCounts);

    case "get-diagnostics":
      return ok(getDiagnostics());

    case "get-error-log":
      return ok(getErrorLog());

    case "clear-error-log":
      await clearErrorLog();
      return ok(undefined);

    case "get-settings":
      return ok(await getSettings());

    case "save-settings":
      await saveSettings(message.captureConfig, message.networkFilter, message.videoConfig);
      return ok(undefined);

    case "start-session": {
      if (bgSession) return fail("Session already active");

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return fail("No active tab found");

      // An explicit session owns the single video stream — suspend the ring.
      await pauseRingForSession();

      const session: Session = {
        id: crypto.randomUUID(),
        tabId: tab.id,
        tabUrl: tab.url,
        tabTitle: tab.title,
        startedAt: Date.now(),
        status: "starting",
        captureConfig: message.captureConfig,
        debuggerSessionId: null,
        domSnapshotCount: 0,
        domSnapshotKeys: [],
        screenshotFilenames: [],
        videoOpfsFilename: null,
        replayOpfsFilename: null,
        eventsOpfsFilename: null,
      };
      eventsWriteChain = Promise.resolve();

      bgSession = session;
      bgCounts = emptyCounts();
      await persistSession();

      // Declare which captures are expected this session so the diagnostics
      // panel can flag any that produce nothing.
      resetDiagnostics(session.id);
      const cc = message.captureConfig;
      if (cc.console) expectStage("debugger", "events");
      if (cc.replay) expectStage("replay", "inject");
      if (cc.video) expectStage("video", "start");

      try {
        const { sessionId: dbgId } = await debuggerBridge.startSession(
          tab.id,
          message.captureConfig
        );
        bgSession.debuggerSessionId = dbgId;
      } catch (err) {
        reportNonFatalError("Failed to start debugger session", err);
      }

      bgSession.status = "recording";
      await persistSession();

      if (message.captureConfig.domSnapshots) {
        await captureAndStoreDomSnapshot(tab.id, "start");
      }

      if (message.captureConfig.replay) {
        await injectReplayRecorderIntoTab(tab.id);
      }

      if (message.captureConfig.video) {
        if ("tabCapture" in chrome) {
          await startVideoCapture(tab.id, bgSession);
        } else {
          await startFirefoxVideoCapture(bgSession);
        }
        markStageOk("video", "start");
      }

      chrome.action.setBadgeText({ text: "REC" });
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });

      return ok(bgSession);
    }

    case "stop-session": {
      if (!bgSession) return fail("No active session");
      // Resume first so MediaRecorder is in a stoppable state and rrweb stops cleanly.
      const wasStopPaused = bgSession.status === "paused";
      bgSession.status = "stopping";
      await persistSession();
      clearAutoCaptureTimers();
      if (wasStopPaused && bgSession.captureConfig.video) {
        await chrome.runtime.sendMessage({ type: "offscreen-resume-recording" }).catch(() => {});
      }
      // Stop the page recorder, let the bridge flush its last batch, then wait
      // for all queued OPFS appends to commit before the recorder reads the file.
      if (bgSession.captureConfig.replay) {
        await stopReplayInTab(bgSession.tabId);
        await replayWriteChain;
      }
      await eventsWriteChain;
      if (bgSession.captureConfig.video) {
        if ("tabCapture" in chrome) {
          await stopVideoCapture();
        } else if (firefoxVideoTabId) {
          firefoxVideoDonePromise = new Promise((resolve) => {
            firefoxVideoDoneResolve = resolve;
          });
          chrome.tabs.sendMessage(firefoxVideoTabId, { type: "fx-video-stop" }).catch(() => {
            // Tab may already be closed
            firefoxVideoDoneResolve?.();
            firefoxVideoDoneResolve = null;
          });
          // Wait for finalization or timeout (10 s is generous for last WebM chunk flush)
          await Promise.race([
            firefoxVideoDonePromise,
            new Promise<void>((r) => setTimeout(r, 10_000)),
          ]);
          firefoxVideoTabId = null;
        }
      }
      await flushDiagnostics();
      chrome.action.setBadgeText({ text: "" });
      const recorderTab = await chrome.tabs.create({
        url: chrome.runtime.getURL(`/recorder.html?sessionId=${bgSession.id}`),
      });
      recorderTabId = recorderTab.id ?? null;
      await resumeRingAfterSession();
      return ok(undefined);
    }

    case "pause-session": {
      if (!bgSession || bgSession.status !== "recording") return fail("No active recording");
      bgSession.status = "paused";
      await persistSession();
      clearAutoCaptureTimers();
      if (bgSession.captureConfig.replay) {
        await stopReplayInTab(bgSession.tabId);
        await replayWriteChain;
      }
      if (bgSession.captureConfig.video) {
        await chrome.runtime.sendMessage({ type: "offscreen-pause-recording" }).catch(() => {});
      }
      chrome.action.setBadgeText({ text: "PAUS" });
      chrome.action.setBadgeBackgroundColor({ color: "#f97316" });
      return ok(undefined);
    }

    case "resume-session": {
      if (!bgSession || bgSession.status !== "paused") return fail("Session is not paused");
      bgSession.status = "recording";
      await persistSession();
      if (bgSession.captureConfig.replay) {
        await injectReplayRecorderIntoTab(bgSession.tabId);
      }
      if (bgSession.captureConfig.video) {
        await chrome.runtime.sendMessage({ type: "offscreen-resume-recording" }).catch(() => {});
      }
      chrome.action.setBadgeText({ text: "REC" });
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
      return ok(undefined);
    }

    case "discard-session": {
      recorderTabId = null;
      clearAutoCaptureTimers();
      if (bgSession?.captureConfig.video) {
        if ("tabCapture" in chrome) {
          await stopVideoCapture();
        } else if (firefoxVideoTabId) {
          chrome.tabs.remove(firefoxVideoTabId).catch(() => {});
          firefoxVideoDoneResolve?.();
          firefoxVideoDoneResolve = null;
          firefoxVideoTabId = null;
        }
      }
      if (bgSession?.debuggerSessionId) {
        await debuggerBridge.discardSession(bgSession.debuggerSessionId);
      }
      if (bgSession) {
        const dir = await navigator.storage.getDirectory();
        for (const filename of bgSession.screenshotFilenames) {
          await dir.removeEntry(filename).catch(() => {});
        }
        for (const key of bgSession.domSnapshotKeys) {
          await dir.removeEntry(domSnapshotOpfsFilename(bgSession.id, key)).catch(() => {});
        }
        if (bgSession.replayOpfsFilename) {
          await dir.removeEntry(bgSession.replayOpfsFilename).catch(() => {});
        }
        if (bgSession.eventsOpfsFilename) {
          await dir.removeEntry(bgSession.eventsOpfsFilename).catch(() => {});
        }
      }
      chrome.action.setBadgeText({ text: "" });
      bgSession = null;
      bgCounts = emptyCounts();
      await setSession(null);
      await resumeRingAfterSession();
      return ok(undefined);
    }

    case "take-screenshot": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.windowId) return fail("No active tab");
      const { windowId, id: tabId } = tab;
      const capturedSessionId = bgSession?.id ?? null;
      // Respond immediately so the popup closes before capture — prevents popup
      // appearing in the screenshot.
      void (async () => {
        try {
          await new Promise<void>((r) => setTimeout(r, SCREENSHOT_POPUP_DISMISS_MS));
          const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
          if (capturedSessionId && bgSession?.id === capturedSessionId) {
            const index = bgSession.screenshotFilenames.length + 1;
            const filename = screenshotOpfsFilename(bgSession.id, index);
            const base64 = dataUrl.split(",")[1] ?? "";
            await writeToOpfs(
              filename,
              Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
            );
            bgSession.screenshotFilenames.push(filename);
            void persistSession();
            bumpCount("screenshots");
            bumpStage("screenshot", "capture");
          } else {
            // Standalone screenshot — write to OPFS with a slug-based name, store
            // the filename (not the data URL) in session storage to stay well under
            // the 10 MB chrome.storage.session quota.
            const slug = slugify(`screenshot-${toFilenameTimestamp(new Date())}`);
            const ssFilename = standaloneScreenshotOpfsFilename(slug);
            const base64 = dataUrl.split(",")[1] ?? "";
            await writeToOpfs(
              ssFilename,
              Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
            );
            await appendStandaloneScreenshotFilename(ssFilename);
            await chrome.tabs.create({
              url: chrome.runtime.getURL("/recorder.html?mode=screenshot"),
              openerTabId: tabId,
            });
          }
        } catch (err) {
          reportNonFatalError("Screenshot capture failed", err);
        }
      })();
      return ok(undefined);
    }

    case "snapshot-dom": {
      if (bgSession) {
        const index = bgSession.domSnapshotCount + 1;
        await captureAndStoreDomSnapshot(bgSession.tabId, String(index));
        bgSession.domSnapshotCount = index;
        void persistSession();
        bumpCount("domSnapshots");
        return ok({ index });
      }

      // Standalone DOM snapshot — no active session. Capture the current page's
      // HTML, write it to OPFS, and open the recorder in snapshot mode to review
      // and export it. Mirrors the standalone screenshot flow.
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return fail("No active tab");
      const { id: tabId } = tab;
      const html = await captureStandaloneDomSnapshot(tabId);
      if (html === null) return fail("Could not capture DOM snapshot");
      const slug = slugify(
        `dom-${toFilenameTimestamp(new Date())}-${crypto.randomUUID().slice(0, 8)}`
      );
      const filename = standaloneDomSnapshotOpfsFilename(slug);
      await writeToOpfs(filename, new TextEncoder().encode(html));
      await appendStandaloneDomSnapshotFilename(filename);
      await chrome.tabs.create({
        url: chrome.runtime.getURL("/recorder.html?mode=snapshot"),
        openerTabId: tabId,
      });
      return ok(undefined);
    }

    case "get-ring-status":
      return ok(getRingStatus());

    case "get-ring-config":
      return ok(ringConfig);

    case "save-ring-config": {
      const prevEnabled = ringConfig.enabled;
      ringConfig = message.ringConfig;
      await saveRingConfig(ringConfig);
      if (ringConfig.enabled !== prevEnabled) {
        await applyRingEnabled(ringConfig.enabled);
      } else if (ringEnabled) {
        // Scope or durations may have changed — re-evaluate the focused tab.
        await refocusActiveTab();
      }
      return ok(undefined);
    }

    case "toggle-ring":
      await applyRingEnabled(message.enabled);
      return ok(getRingStatus());

    case "get-ring-tabs":
      return ok(await listRingTabs());

    case "pin-site": {
      ringPins = await addRingPin(message.host);
      await refocusActiveTab();
      return ok(getRingStatus());
    }

    case "unpin-site": {
      ringPins = await removeRingPin(message.host);
      await refocusActiveTab();
      return ok(getRingStatus());
    }

    case "save-ring-scope": {
      ringConfig = { ...ringConfig, scope: message.scope };
      await saveRingConfig(ringConfig);
      if (ringEnabled) await refocusActiveTab();
      return ok(getRingStatus());
    }

    case "export-ring":
      await snapshotRingAndExport();
      return ok(undefined);

    default:
      return fail("Unknown message type");
  }
}

async function handleCommand(command: string) {
  switch (command) {
    case "start-session": {
      const { captureConfig } = await getSettings();
      await handleMessage({ type: "start-session", captureConfig });
      break;
    }
    case "stop-session":
      await handleMessage({ type: "stop-session" });
      break;
    case "take-screenshot":
      await handleMessage({ type: "take-screenshot" });
      break;
    case "snapshot-dom":
      await handleMessage({ type: "snapshot-dom" });
      break;
  }
}

// ─── Capture helpers ─────────────────────────────────────────────────────────

async function captureAndStoreDomSnapshot(tabId: number, key: string): Promise<void> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: serializeDom,
    });
    if (result?.result && bgSession) {
      const html = result.result as string;
      const filename = domSnapshotOpfsFilename(bgSession.id, key);
      await writeToOpfs(filename, new TextEncoder().encode(html));
      bgSession.domSnapshotKeys.push(key);
      void persistSession();
      bumpStage("dom", "snapshot");
    }
  } catch (err) {
    failStage("dom", "snapshot", err);
    reportNonFatalError(`DOM snapshot (${key}) failed`, err);
  }
}

// Captures a DOM snapshot without storing it against a session — used for the
// standalone (no active session) snapshot flow. Returns the serialized HTML, or
// null if the page could not be read (e.g. chrome:// pages).
async function captureStandaloneDomSnapshot(tabId: number): Promise<string | null> {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: serializeDom,
    });
    return (result?.result as string | undefined) ?? null;
  } catch (err) {
    reportNonFatalError("Standalone DOM snapshot failed", err);
    return null;
  }
}

// Runs inside the page — no closure access
function serializeDom(): string {
  const base = document.createElement("base");
  base.href = location.href;
  const head = document.head.cloneNode(true) as HTMLElement;
  head.prepend(base);

  const inlined: string[] = [];
  for (const sheet of document.styleSheets) {
    try {
      const rules = Array.from(sheet.cssRules)
        .map((r) => r.cssText)
        .join("\n");
      inlined.push(`<style>/* ${sheet.href ?? "inline"} */\n${rules}</style>`);
    } catch {
      inlined.push(`<!-- cross-origin stylesheet skipped: ${sheet.href} -->`);
    }
  }

  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelector("head")?.insertAdjacentHTML("beforeend", inlined.join("\n"));
  return `<!doctype html>\n${clone.outerHTML}`;
}

async function captureAutoScreenshot(tabId: number): Promise<void> {
  if (!bgSession || bgSession.tabId !== tabId || bgSession.status === "paused") return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.windowId) return;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    const index = bgSession.screenshotFilenames.length + 1;
    const filename = screenshotOpfsFilename(bgSession.id, index);
    const base64 = dataUrl.split(",")[1] ?? "";
    await writeToOpfs(
      filename,
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    );
    bgSession.screenshotFilenames.push(filename);
    void persistSession();
    bumpCount("screenshots");
  } catch (err) {
    reportNonFatalError("Auto-screenshot failed", err);
  }
}

async function captureAutoDomSnapshot(tabId: number): Promise<void> {
  if (!bgSession || bgSession.tabId !== tabId || bgSession.status === "paused") return;
  const index = bgSession.domSnapshotCount + 1;
  await captureAndStoreDomSnapshot(tabId, `auto-${index}`);
  bgSession.domSnapshotCount = index;
  void persistSession();
  bumpCount("domSnapshots");
}

// ─── Video capture ────────────────────────────────────────────────────────────

async function startFirefoxVideoCapture(session: Session): Promise<void> {
  const filename = `${OPFS_PREFIX}fx-recording-${session.id}.webm`;
  // Set the filename now so the recorder can find the file even if the video
  // tab finishes before the recorder opens (or the session crashes).
  session.videoOpfsFilename = filename;
  await persistSession();

  const tabTitle = encodeURIComponent(session.tabTitle ?? "");
  const url = chrome.runtime.getURL(
    `/firefox-video.html?sessionId=${session.id}&tabTitle=${tabTitle}&filename=${encodeURIComponent(filename)}`
  );
  const tab = await chrome.tabs.create({ url });
  firefoxVideoTabId = tab.id ?? null;
}

async function startVideoCapture(tabId: number, session: Session): Promise<void> {
  if (!("tabCapture" in chrome) || !("offscreen" in chrome)) return;

  const { videoConfig } = await getSettings();
  const ext = videoConfig.format === "h264" ? ".mp4" : ".webm";
  const filename = `${OPFS_PREFIX}recording-${session.id}${ext}`;
  session.videoOpfsFilename = filename;
  await persistSession();

  let streamId: string;
  try {
    streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });
  } catch (err) {
    reportNonFatalError("tabCapture.getMediaStreamId failed", err);
    session.videoOpfsFilename = null;
    await persistSession();
    return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL("offscreen.html"),
      reasons: ["USER_MEDIA" as chrome.offscreen.Reason],
      justification: "Record tab video via tabCapture getUserMedia",
    });
  } catch (err) {
    reportNonFatalError("Failed to create offscreen document", err);
    session.videoOpfsFilename = null;
    await persistSession();
    return;
  }

  await chrome.runtime.sendMessage({
    type: "offscreen-start-recording",
    streamId,
    filename,
    videoConfig,
  });
}

async function stopVideoCapture(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "offscreen-stop-recording" });
  } catch {
    // offscreen may already be gone
  }
  // Allow MediaRecorder.onstop to fire before closing the document
  await new Promise<void>((r) => setTimeout(r, VIDEO_STOP_GRACE_MS));
  await closeOffscreenIfOpen();
}

async function closeOffscreenIfOpen(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // already closed
  }
}

async function handleOffscreenMessage(msg: OffscreenMsg): Promise<void> {
  if (msg.type === "offscreen-recording-done") {
    bumpStage("video", "write", msg.totalBytes);
    await closeOffscreenIfOpen();
  } else if (msg.type === "offscreen-size-warning" && msg.megabytes >= 500) {
    await closeOffscreenIfOpen();
  } else if (msg.type === "offscreen-error") {
    failStage("video", "write", msg.message);
    reportNonFatalError("Video recording error", new Error(msg.message));
    await closeOffscreenIfOpen();
  } else if (msg.type === "offscreen-ring-chunk") {
    pruneRingBuffer();
    ringVideoChunks.push({
      bytes: new Uint8Array(msg.chunk),
      timestamp: Date.now(),
      mimeType: msg.mimeType,
    });
  } else if (msg.type === "offscreen-ring-stopped") {
    ringVideoActive = false;
  }
}

// ─── OPFS sweep ───────────────────────────────────────────────────────────────
// Deletes only OPFS_PREFIX files not owned by the active session. Called after
// initState() so bgSession reflects any session that survived a SW restart.

async function sweepOrphanedOpfsFiles(): Promise<void> {
  try {
    const sess = bgSession;
    const standaloneScreenshots = await getStandaloneScreenshotFilenames();
    const standaloneDomSnapshots = await getStandaloneDomSnapshotFilenames();
    const activeFiles = new Set<string>([
      ...standaloneScreenshots,
      ...standaloneDomSnapshots,
      ...(sess?.screenshotFilenames ?? []),
      ...(sess?.videoOpfsFilename ? [sess.videoOpfsFilename] : []),
      ...(sess?.replayOpfsFilename ? [sess.replayOpfsFilename] : []),
      ...(sess?.eventsOpfsFilename ? [sess.eventsOpfsFilename] : []),
      ...(sess ? sess.domSnapshotKeys.map((k) => domSnapshotOpfsFilename(sess.id, k)) : []),
    ]);

    const dir = await navigator.storage.getDirectory();
    const toDelete: string[] = [];
    for await (const [name] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (name.startsWith(OPFS_PREFIX) && !activeFiles.has(name)) {
        toDelete.push(name);
      }
    }
    for (const name of toDelete) {
      await dir.removeEntry(name).catch(() => {});
    }
  } catch {
    // OPFS not available
  }
}

// ─── Ring buffer helpers ──────────────────────────────────────────────────────

function pruneRingBuffer(): void {
  const now = Date.now();
  const dataCutoff = now - ringConfig.dataDurationSec * 1000;
  const videoCutoff = now - ringConfig.videoDurationSec * 1000;
  for (const buf of ringBuffers.values()) {
    buf.console = buf.console.filter((e) => e.timestamp >= dataCutoff);
    buf.network = buf.network.filter((e) => e.timestamp >= dataCutoff);
    buf.interactions = buf.interactions.filter((e) => e.timestamp >= dataCutoff);
    buf.performance = buf.performance.filter((e) => e.timestamp >= dataCutoff);
    // Drop a retained buffer once it has aged out entirely; keep the tab we're
    // actively recording even while momentarily empty.
    if (ringBufferSize(buf) === 0 && buf.tabId !== ringTabId) ringBuffers.delete(buf.tabId);
  }
  ringVideoChunks = ringVideoChunks.filter((c) => c.timestamp >= videoCutoff);
}

function getRingStatus(): RingStatus {
  let consoleN = 0;
  let networkN = 0;
  let interactionsN = 0;
  let oldest: number | null = null;
  let retainedTabCount = 0;
  for (const buf of ringBuffers.values()) {
    consoleN += buf.console.length;
    networkN += buf.network.length;
    interactionsN += buf.interactions.length;
    for (const arr of [buf.console, buf.network, buf.interactions, buf.performance]) {
      for (const e of arr) if (oldest === null || e.timestamp < oldest) oldest = e.timestamp;
    }
    if (buf.tabId !== ringTabId && ringBufferSize(buf) > 0) retainedTabCount++;
  }
  return {
    active: ringEnabled,
    tabId: ringActive ? ringTabId : null,
    tabUrl: ringActive ? ringTabUrl : undefined,
    tabTitle: ringActive ? ringTabTitle : undefined,
    oldestEventMs: oldest,
    eventCounts: { console: consoleN, network: networkN, interactions: interactionsN },
    hasVideo: ringVideoChunks.length > 0,
    reason: ringEnabled ? ringReason : null,
    retainedTabCount,
  };
}

// Evaluate a URL against the current scope + pins.
function isRingEligible(url: string | undefined): RingEligibility {
  return evaluateRingScope(url, ringConfig.scope, ringPins);
}

// Trust signal: a blue dot on the toolbar icon while a tab is actively being
// ring-recorded, visually distinct from the red "REC" of an explicit session.
// Never overrides an active session's badge (sessions pause the ring anyway).
function setRingBadge(on: boolean): void {
  if (bgSession && bgSession.status === "recording") return;
  if (on) {
    chrome.action.setBadgeText({ text: "●" });
    chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// Suspend the ring so an explicit recording session can own the video stream.
async function pauseRingForSession(): Promise<void> {
  ringPausedForSession = true;
  if (ringActive) await stopActiveRecording();
}

// Resume the ring after an explicit session ends (if it was on). It re-attaches
// once the user focuses an in-scope tab.
async function resumeRingAfterSession(): Promise<void> {
  if (!ringPausedForSession) return;
  ringPausedForSession = false;
  if (!ringEnabled) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) await refocusRing(tab.id, tab.url);
  } catch {
    // no focused tab
  }
}

// Turn the ring feature on/off. Persists `enabled`, and when turning on with an
// empty allowlist auto-pins the focused site so recording isn't dead on arrival.
async function applyRingEnabled(enabled: boolean): Promise<void> {
  ringEnabled = enabled;
  ringConfig = { ...ringConfig, enabled };
  await saveRingConfig(ringConfig);

  if (!enabled) {
    await stopActiveRecording();
    ringBuffers.clear();
    ringReason = null;
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const elig = isRingEligible(tab.url);
  if (elig.reason === "empty-allowlist") {
    const host = hostFromUrl(tab.url);
    if (host) ringPins = await addRingPin(host);
  }
  await refocusRing(tab.id, tab.url);
}

// Re-evaluate whichever tab is currently focused (after a scope/pin change).
async function refocusActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await refocusRing(tab.id, tab.url);
}

// Central focus-follows logic: recording tracks the focused tab, gated by scope.
// Called on tab activation, focused-tab navigation, and scope/pin changes.
async function refocusRing(tabId: number, url?: string): Promise<void> {
  if (!ringEnabled || ringPausedForSession) return;
  let tabUrl = url;
  if (tabUrl === undefined) {
    try {
      tabUrl = (await chrome.tabs.get(tabId)).url;
    } catch {
      return; // tab gone
    }
  }

  const elig = isRingEligible(tabUrl);
  ringReason = elig.reason;

  if (elig.recordable) {
    if (ringTabId !== tabId) await rotateRingToTab(tabId);
  } else if (ringActive) {
    // Focused (or navigated to) an ineligible page — stop capturing.
    await stopActiveRecording();
  }
}

// Build the popup's tab picker: every tab in the focused window with its
// eligibility, pin state, and whether it's the one recording now.
async function listRingTabs(): Promise<RingTabInfo[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const infos: RingTabInfo[] = [];
  for (const t of tabs) {
    if (t.id === undefined) continue;
    const elig = isRingEligible(t.url);
    const host = hostFromUrl(t.url);
    infos.push({
      tabId: t.id,
      url: t.url,
      title: t.title,
      host,
      recordable: elig.recordable,
      reason: elig.reason,
      pinned: host !== null && ringPins.includes(host),
      isRecording: ringActive && ringTabId === t.id,
      retained: false,
    });
  }
  return infos;
}

async function startRingVideoCapture(tabId: number): Promise<void> {
  if (!("tabCapture" in chrome) || !("offscreen" in chrome)) return;
  if (bgSession?.captureConfig.video && bgSession.status !== "stopping") return;

  let streamId: string;
  try {
    streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      });
    });
  } catch (err) {
    reportNonFatalError("Ring tabCapture.getMediaStreamId failed", err);
    return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL("offscreen.html"),
      reasons: ["USER_MEDIA" as chrome.offscreen.Reason],
      justification: "Record ring tab video via tabCapture getUserMedia",
    });
  } catch (err) {
    reportNonFatalError("Ring failed to create offscreen document", err);
    return;
  }

  const { videoConfig } = await getSettings();
  ringVideoActive = true;
  await chrome.runtime.sendMessage({ type: "offscreen-start-ring", streamId, videoConfig });
}

async function stopRingVideoCapture(): Promise<void> {
  if (!ringVideoActive) return;
  try {
    await chrome.runtime.sendMessage({ type: "offscreen-stop-ring" });
  } catch {
    // offscreen may already be gone
  }
  await new Promise<void>((r) => setTimeout(r, VIDEO_STOP_GRACE_MS));
  await closeOffscreenIfOpen();
  ringVideoActive = false;
}

async function startRingOnTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    ringTabId = tabId;
    ringTabUrl = tab.url;
    ringTabTitle = tab.title;
    ringActive = true;
    // Reuse this tab's retained buffer if it still has recent data, else start
    // a fresh one — so returning to a tab picks up its history.
    ensureRingBuffer(tabId, tab.url, tab.title);

    // The ring honors the performance beta toggle so always-on capture matches
    // what an explicit session would collect.
    const { captureConfig } = await getSettings();
    const { sessionId: dbgId } = await debuggerBridge.startSession(tabId, {
      fullSelectorPath: true,
      performance: captureConfig.performance,
    });
    ringDebuggerSessionId = dbgId;

    if (ringConfig.videoDurationSec > 0) {
      await startRingVideoCapture(tabId);
    }
    setRingBadge(true);
  } catch (err) {
    reportNonFatalError("Failed to start ring on tab", err);
    ringActive = false;
    ringTabId = null;
  }
}

// Stop actively recording (video + debugger session). The tab's buffered data is
// RETAINED for the merged export; only video is dropped (it follows focus only).
// Does not touch `ringEnabled` — the feature stays on, just idle.
async function stopActiveRecording(): Promise<void> {
  const stoppingTabId = ringTabId;
  ringActive = false;
  await stopRingVideoCapture();
  if (ringDebuggerSessionId) {
    await debuggerBridge.discardSession(ringDebuggerSessionId).catch(() => {});
    ringDebuggerSessionId = null;
  }
  if (stoppingTabId !== null) {
    const buf = ringBuffers.get(stoppingTabId);
    if (buf) buf.lastActiveMs = Date.now();
  }
  ringTabId = null;
  ringTabUrl = undefined;
  ringTabTitle = undefined;
  ringVideoChunks = [];
  setRingBadge(false);
}

async function rotateRingToTab(newTabId: number): Promise<void> {
  if (ringActive) await stopActiveRecording();
  await startRingOnTab(newTabId);
}

async function snapshotRingAndExport(): Promise<void> {
  pruneRingBuffer();

  let videoOpfsFilename: string | null = null;
  if (ringVideoChunks.length > 0) {
    const id = crypto.randomUUID();
    videoOpfsFilename = `${OPFS_PREFIX}ring-${id}.webm`;
    const totalSize = ringVideoChunks.reduce((n, c) => n + c.bytes.byteLength, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of ringVideoChunks) {
      combined.set(chunk.bytes, offset);
      offset += chunk.bytes.byteLength;
    }
    await writeToOpfs(videoOpfsFilename, combined);
  }

  // Merge every retained tab's events into one timeline. The report already
  // sorts by each event's own timestamp, so concatenation is enough for time
  // ordering. When more than one tab contributed, tag each event with its source
  // so an interleaved repro reads coherently; a single-tab export stays unlabeled.
  const buffers = [...ringBuffers.values()].filter((b) => ringBufferSize(b) > 0);
  const multiTab = buffers.length > 1;
  const label = (buf: RingTabBuffer, event: unknown): unknown => {
    if (!multiTab || typeof event !== "object" || event === null) return event;
    return {
      ...(event as Record<string, unknown>),
      __ringSource: { tabId: buf.tabId, title: buf.title, host: buf.host },
    };
  };

  const consoleEvents: unknown[] = [];
  const networkEvents: unknown[] = [];
  const interactionEvents: unknown[] = [];
  const performanceEvents: unknown[] = [];
  for (const buf of buffers) {
    for (const e of buf.console) consoleEvents.push(label(buf, e.event));
    for (const e of buf.network) networkEvents.push(label(buf, e.event));
    for (const e of buf.interactions) interactionEvents.push(label(buf, e.event));
    for (const e of buf.performance) performanceEvents.push(label(buf, e.event));
  }

  // Primary tab for the report title: the one recording now, else the most
  // recently active retained tab (the ineligible-focus fallback).
  const primary =
    (ringTabId !== null ? ringBuffers.get(ringTabId) : undefined) ??
    [...buffers].sort((a, b) => b.lastActiveMs - a.lastActiveMs)[0];

  const snapshot: RingSnapshot = {
    id: crypto.randomUUID(),
    tabUrl: primary?.url ?? ringTabUrl,
    tabTitle: primary?.title ?? ringTabTitle,
    startedAt: Date.now(),
    console: consoleEvents,
    network: networkEvents,
    interactions: interactionEvents,
    performance: performanceEvents,
    videoOpfsFilename,
  };

  await setRingSnapshot(snapshot);
  await chrome.tabs.create({ url: chrome.runtime.getURL("/recorder.html?mode=ring") });
}
