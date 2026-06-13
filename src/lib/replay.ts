import { REPLAY_STOP_MESSAGE } from "@/lib/replay-messaging";
import { reportNonFatalError } from "@/vendor/shared/lib/errors";

// WXT bundles the defineUnlistedScript entrypoints to these filenames.
const REPLAY_RECORD_FILE = "replay-record.js";
const REPLAY_BRIDGE_FILE = "replay-content-bridge.js";

/**
 * Inject the rrweb recorder + its event bridge into a tab (experimental). Called
 * on session start and re-called after each navigation so recording resumes on
 * the new document. The ISOLATED bridge goes in first so it's listening before
 * the MAIN-world recorder starts emitting. Both scripts self-guard against
 * double-injection within a single document.
 */
export async function injectReplayRecorderIntoTab(tabId: number): Promise<void> {
  if (!chrome.scripting?.executeScript) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [REPLAY_BRIDGE_FILE] });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: [REPLAY_RECORD_FILE],
    });
  } catch (error) {
    reportNonFatalError(`Failed to inject replay recorder into tab ${tabId}`, error);
  }
}

/**
 * Tell the page to stop recording and flush any buffered events. Resolves once
 * the bridge acknowledges the flush, so the caller can finalize the OPFS file.
 */
export async function stopReplayInTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: REPLAY_STOP_MESSAGE });
  } catch {
    // Tab gone or bridge never injected — events already streamed are in OPFS.
  }
}
