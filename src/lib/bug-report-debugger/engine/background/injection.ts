import { reportNonFatalError } from "@/shared/lib/errors";

// WXT bundles defineUnlistedScript entrypoints to these filenames
const CONTENT_BRIDGE_FILE = "debugger-content-bridge.js";
const PAGE_RUNTIME_FILE = "debugger-page.js";

export function createSessionId(): string {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `dbg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function injectDebuggerScriptIntoTab(tabId: number): Promise<void> {
  if (!chrome.scripting?.executeScript) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_BRIDGE_FILE] });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: [PAGE_RUNTIME_FILE],
    });
  } catch (error) {
    reportNonFatalError(`Failed to inject debugger into tab ${tabId}`, error);
  }
}

export function isInjectablePageUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}
