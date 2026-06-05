import {
  type DebuggerBridge,
  registerDebuggerBackgroundListeners,
} from "@/lib/bug-report-debugger/engine/background";
import { isDebuggerRuntimeMessage } from "@/lib/bug-report-debugger/messaging";
import { fail, ok } from "@/lib/messaging";
import {
  OPFS_PREFIX,
  appendScreenshot,
  domSnapshotOpfsFilename,
  getCounts,
  getRingConfig,
  getSession,
  getSettings,
  saveCounts,
  saveRingConfig,
  saveSettings,
  screenshotOpfsFilename,
  setRingSnapshot,
  setSession,
} from "@/lib/storage";
import {
  DEFAULT_RING_CONFIG,
  type BgMessage,
  type RingConfig,
  type RingSnapshot,
  type RingStatus,
  type Session,
  type SessionCounts,
} from "@/lib/types";
import { reportNonFatalError } from "@/vendor/shared/lib/errors";

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

function emptyCounts(): SessionCounts {
  return { console: 0, network: 0, interactions: 0, domSnapshots: 0, screenshots: 0, errors: 0 };
}

// ─── Ring state ───────────────────────────────────────────────────────────────

interface TimestampedEvent { timestamp: number; event: unknown }
interface RingVideoChunk { bytes: Uint8Array; timestamp: number; mimeType: string }

let ringConfig: RingConfig = DEFAULT_RING_CONFIG;
let ringActive = false;
let ringTabId: number | null = null;
let ringTabUrl: string | undefined;
let ringTabTitle: string | undefined;
let ringDebuggerSessionId: string | null = null;
let ringVideoActive = false;
let ringConsoleEvents: TimestampedEvent[] = [];
let ringNetworkEvents: TimestampedEvent[] = [];
let ringInteractionEvents: TimestampedEvent[] = [];
let ringVideoChunks: RingVideoChunk[] = [];

async function initState(): Promise<void> {
  bgSession = await getSession();
  bgCounts = await getCounts();
  ringConfig = await getRingConfig();
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

// ─── OPFS write helper ───────────────────────────────────────────────────────

async function writeToOpfs(filename: string, bytes: Uint8Array): Promise<void> {
  const dir = await navigator.storage.getDirectory();
  const handle = await dir.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  // Buffer is always a plain ArrayBuffer here; cast avoids the ArrayBufferLike widening
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writable.write(bytes.buffer as ArrayBuffer);
  await writable.close();
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

// ─── Entry point ─────────────────────────────────────────────────────────────

export default defineBackground(async () => {
  await initState();
  await sweepOrphanedOpfsFiles();

  debuggerBridge = registerDebuggerBackgroundListeners(async (tabId, rawEvents) => {
    type RawEvent = { kind?: string; actionType?: string; metadata?: { mode?: string } };
    const events = rawEvents as RawEvent[];

    if (bgSession?.tabId === tabId) {
      let consoleN = 0;
      let networkN = 0;
      let interactionsN = 0;
      let hasAutoTriggerAction = false;
      for (const e of events) {
        if (e.kind === "console") consoleN++;
        else if (e.kind === "network") networkN++;
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
      if (interactionsN > 0) bumpCount("interactions", interactionsN);

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
      const now = Date.now();
      for (const ev of events) {
        const timestamped = { timestamp: now, event: ev };
        if (ev.kind === "console") ringConsoleEvents.push(timestamped);
        else if (ev.kind === "network") ringNetworkEvents.push(timestamped);
        else if (ev.kind === "action") ringInteractionEvents.push(timestamped);
      }
    }
  }, (tabId) => bgSession?.tabId === tabId || (ringActive && ringTabId === tabId));

  chrome.runtime.onMessage.addListener((message: BgMessage, _sender, sendResponse) => {
    if (isDebuggerRuntimeMessage(message)) return;
    if (isOffscreenMessage(message)) {
      void handleOffscreenMessage(message);
      return false;
    }
    handleMessage(message)
      .then(sendResponse)
      .catch((err: unknown) => {
        reportNonFatalError("Background message handler failed", err);
        sendResponse(fail(err instanceof Error ? err.message : "Unknown error"));
      });
    return true;
  });

  chrome.commands.onCommand.addListener((command) => {
    handleCommand(command).catch((err: unknown) =>
      reportNonFatalError(`Command ${command} failed`, err)
    );
  });

  chrome.tabs.onRemoved.addListener(async (tabId) => {
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

    if (bgSession?.tabId !== tabId) return;
    // Session tab closed — treat the same as stop-session so data isn't lost.
    // shouldPreserveTab prevents the debugger bridge from discarding the session
    // so the recorder can still read console/network/interaction events.
    clearAutoCaptureTimers();
    if (bgSession.captureConfig.video) await stopVideoCapture();
    bgSession.status = "stopping";
    await persistSession();
    chrome.action.setBadgeText({ text: "" });
    const recorderTab = await chrome.tabs.create({
      url: chrome.runtime.getURL(`/recorder.html?sessionId=${bgSession.id}`),
    });
    recorderTabId = recorderTab.id ?? null;
  });

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    if (!ringActive || ringTabId === tabId) return;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("about:")) return;
      await rotateRingToTab(tabId);
    } catch {
      // tab may not exist yet
    }
  });
});

// ─── Message handler ─────────────────────────────────────────────────────────

async function handleMessage(message: BgMessage) {
  switch (message.type) {
    case "get-session":
      return ok(bgSession);

    case "get-counts":
      return ok(bgCounts);

    case "get-settings":
      return ok(await getSettings());

    case "save-settings":
      await saveSettings(message.captureConfig, message.networkFilter);
      return ok(undefined);

    case "start-session": {
      if (bgSession) return fail("Session already active");

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return fail("No active tab found");

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
      };

      bgSession = session;
      bgCounts = emptyCounts();
      await persistSession();

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

      if (message.captureConfig.video) {
        await startVideoCapture(tab.id, bgSession);
      }

      chrome.action.setBadgeText({ text: "REC" });
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });

      return ok(bgSession);
    }

    case "stop-session": {
      if (!bgSession) return fail("No active session");
      bgSession.status = "stopping";
      await persistSession();
      clearAutoCaptureTimers();
      if (bgSession.captureConfig.video) await stopVideoCapture();
      chrome.action.setBadgeText({ text: "" });
      const recorderTab = await chrome.tabs.create({
        url: chrome.runtime.getURL(`/recorder.html?sessionId=${bgSession.id}`),
      });
      recorderTabId = recorderTab.id ?? null;
      return ok(undefined);
    }

    case "discard-session": {
      recorderTabId = null;
      clearAutoCaptureTimers();
      if (bgSession?.captureConfig.video) await stopVideoCapture();
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
      }
      chrome.action.setBadgeText({ text: "" });
      bgSession = null;
      bgCounts = emptyCounts();
      await setSession(null);
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
        } else {
          // Standalone screenshot — temporary session storage, open recorder to annotate
          await appendScreenshot(dataUrl);
          await chrome.tabs.create({
            url: chrome.runtime.getURL("/recorder.html?mode=screenshot"),
            openerTabId: tabId,
          });
        }
      })();
      return ok(undefined);
    }

    case "snapshot-dom": {
      if (!bgSession) return fail("No active session");
      const index = bgSession.domSnapshotCount + 1;
      await captureAndStoreDomSnapshot(bgSession.tabId, String(index));
      bgSession.domSnapshotCount = index;
      void persistSession();
      bumpCount("domSnapshots");
      return ok({ index });
    }

    case "get-ring-status":
      return ok(getRingStatus());

    case "get-ring-config":
      return ok(ringConfig);

    case "save-ring-config":
      ringConfig = message.ringConfig;
      await saveRingConfig(ringConfig);
      return ok(undefined);

    case "toggle-ring": {
      if (message.enabled && !ringActive) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) await startRingOnTab(tab.id);
      } else if (!message.enabled && ringActive) {
        await stopRingOnTab();
      }
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
    }
  } catch (err) {
    reportNonFatalError(`DOM snapshot (${key}) failed`, err);
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
  if (!bgSession || bgSession.tabId !== tabId) return;
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
  if (!bgSession || bgSession.tabId !== tabId) return;
  const index = bgSession.domSnapshotCount + 1;
  await captureAndStoreDomSnapshot(tabId, `auto-${index}`);
  bgSession.domSnapshotCount = index;
  void persistSession();
  bumpCount("domSnapshots");
}

// ─── Video capture ────────────────────────────────────────────────────────────

async function startVideoCapture(tabId: number, session: Session): Promise<void> {
  if (!("tabCapture" in chrome) || !("offscreen" in chrome)) return;

  const filename = `${OPFS_PREFIX}recording-${session.id}.webm`;
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

  await chrome.runtime.sendMessage({ type: "offscreen-start-recording", streamId, filename });
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
    await closeOffscreenIfOpen();
  } else if (msg.type === "offscreen-size-warning" && msg.megabytes >= 500) {
    await closeOffscreenIfOpen();
  } else if (msg.type === "offscreen-error") {
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
    const activeFiles = new Set<string>([
      ...(sess?.screenshotFilenames ?? []),
      ...(sess?.videoOpfsFilename ? [sess.videoOpfsFilename] : []),
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
  ringConsoleEvents = ringConsoleEvents.filter((e) => e.timestamp >= dataCutoff);
  ringNetworkEvents = ringNetworkEvents.filter((e) => e.timestamp >= dataCutoff);
  ringInteractionEvents = ringInteractionEvents.filter((e) => e.timestamp >= dataCutoff);
  ringVideoChunks = ringVideoChunks.filter((c) => c.timestamp >= videoCutoff);
}

function getRingStatus(): RingStatus {
  const allEvents = [...ringConsoleEvents, ...ringNetworkEvents, ...ringInteractionEvents];
  const oldest = allEvents.length > 0 ? Math.min(...allEvents.map((e) => e.timestamp)) : null;
  return {
    active: ringActive,
    tabId: ringTabId,
    tabUrl: ringTabUrl,
    tabTitle: ringTabTitle,
    oldestEventMs: oldest,
    eventCounts: {
      console: ringConsoleEvents.length,
      network: ringNetworkEvents.length,
      interactions: ringInteractionEvents.length,
    },
    hasVideo: ringVideoChunks.length > 0,
  };
}

async function startRingVideoCapture(tabId: number): Promise<void> {
  if (!("tabCapture" in chrome) || !("offscreen" in chrome)) return;
  if (bgSession && bgSession.captureConfig.video && bgSession.status !== "stopping") return;

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

  ringVideoActive = true;
  await chrome.runtime.sendMessage({ type: "offscreen-start-ring", streamId });
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

    const { sessionId: dbgId } = await debuggerBridge.startSession(tabId, {
      fullSelectorPath: true,
    });
    ringDebuggerSessionId = dbgId;

    if (ringConfig.videoDurationSec > 0) {
      await startRingVideoCapture(tabId);
    }
  } catch (err) {
    reportNonFatalError("Failed to start ring on tab", err);
    ringActive = false;
    ringTabId = null;
  }
}

async function stopRingOnTab(): Promise<void> {
  ringActive = false;
  await stopRingVideoCapture();
  if (ringDebuggerSessionId) {
    await debuggerBridge.discardSession(ringDebuggerSessionId).catch(() => {});
    ringDebuggerSessionId = null;
  }
  ringTabId = null;
  ringTabUrl = undefined;
  ringTabTitle = undefined;
  ringConsoleEvents = [];
  ringNetworkEvents = [];
  ringInteractionEvents = [];
  ringVideoChunks = [];
}

async function rotateRingToTab(newTabId: number): Promise<void> {
  const wasActive = ringActive;
  if (wasActive) {
    await stopRingVideoCapture();
    if (ringDebuggerSessionId) {
      await debuggerBridge.discardSession(ringDebuggerSessionId).catch(() => {});
      ringDebuggerSessionId = null;
    }
    ringTabId = null;
    ringTabUrl = undefined;
    ringTabTitle = undefined;
    ringConsoleEvents = [];
    ringNetworkEvents = [];
    ringInteractionEvents = [];
    ringVideoChunks = [];
    ringActive = false;
  }
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

  const snapshot: RingSnapshot = {
    id: crypto.randomUUID(),
    tabUrl: ringTabUrl,
    tabTitle: ringTabTitle,
    startedAt: Date.now(),
    console: ringConsoleEvents.map((e) => e.event),
    network: ringNetworkEvents.map((e) => e.event),
    interactions: ringInteractionEvents.map((e) => e.event),
    videoOpfsFilename,
  };

  await setRingSnapshot(snapshot);
  await chrome.tabs.create({ url: chrome.runtime.getURL("/recorder.html?mode=ring") });
}
