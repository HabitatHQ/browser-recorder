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
  getSession,
  getSettings,
  saveCounts,
  saveSettings,
  screenshotOpfsFilename,
  setSession,
} from "@/lib/storage";
import type { BgMessage, Session, SessionCounts } from "@/lib/types";
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

function emptyCounts(): SessionCounts {
  return { console: 0, network: 0, interactions: 0, domSnapshots: 0, screenshots: 0, errors: 0 };
}

async function initState(): Promise<void> {
  bgSession = await getSession();
  bgCounts = await getCounts();
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
  | { type: "offscreen-error"; message: string };

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
    if (bgSession?.tabId !== tabId) return;

    type RawEvent = { kind?: string; actionType?: string; metadata?: { mode?: string } };
    const events = rawEvents as RawEvent[];

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

    if (!hasAutoTriggerAction) return;

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
  });

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
    if (bgSession?.tabId === tabId) {
      clearAutoCaptureTimers();
      if (bgSession.captureConfig.video) await stopVideoCapture();
      chrome.action.setBadgeText({ text: "" });
      bgSession = null;
      bgCounts = emptyCounts();
      await setSession(null);
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
      await chrome.tabs.create({
        url: chrome.runtime.getURL(`/recorder.html?sessionId=${bgSession.id}`),
      });
      return ok(undefined);
    }

    case "discard-session": {
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
