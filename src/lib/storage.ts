import {
  type CaptureConfig,
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_NETWORK_FILTER,
  type NetworkFilterConfig,
  type Session,
  type SessionCounts,
} from "./types";

// Shared OPFS prefix — all extension-owned OPFS files use this to avoid
// colliding with other extensions that might share the same origin storage.
export const OPFS_PREFIX = "chrome-recorder-";

export function screenshotOpfsFilename(sessionId: string, index: number): string {
  return `${OPFS_PREFIX}screenshot-${sessionId}-${index}.png`;
}

export function domSnapshotOpfsFilename(sessionId: string, key: string): string {
  return `${OPFS_PREFIX}dom-${sessionId}-${key}.html`;
}

const KEYS = {
  session: "session",
  counts: "counts",
  captureConfig: "captureConfig",
  networkFilter: "networkFilter",
  screenshots: "screenshots", // string[] — base64 data URLs for standalone (non-session) screenshots only
} as const;

// Session state lives in chrome.storage.session (cleared on browser restart)
export async function getSession(): Promise<Session | null> {
  const result = await chrome.storage.session.get(KEYS.session);
  return (result[KEYS.session] as Session | undefined) ?? null;
}

export async function setSession(session: Session | null): Promise<void> {
  if (session === null) {
    await chrome.storage.session.remove([KEYS.session, KEYS.counts, KEYS.screenshots]);
  } else {
    await chrome.storage.session.set({ [KEYS.session]: session });
  }
}

export async function getCounts(): Promise<SessionCounts> {
  const result = await chrome.storage.session.get(KEYS.counts);
  return (
    (result[KEYS.counts] as SessionCounts | undefined) ?? {
      console: 0,
      network: 0,
      interactions: 0,
      domSnapshots: 0,
      screenshots: 0,
      errors: 0,
    }
  );
}

export async function saveCounts(counts: SessionCounts): Promise<void> {
  await chrome.storage.session.set({ [KEYS.counts]: counts });
}

// Standalone (non-session) screenshots only — session screenshots use OPFS
export async function appendScreenshot(dataUrl: string): Promise<void> {
  const existing = await getScreenshots();
  await chrome.storage.session.set({ [KEYS.screenshots]: [...existing, dataUrl] });
}

export async function getScreenshots(): Promise<string[]> {
  const result = await chrome.storage.session.get(KEYS.screenshots);
  return (result[KEYS.screenshots] as string[] | undefined) ?? [];
}

// Settings live in chrome.storage.local (persistent)
export async function getSettings(): Promise<{
  captureConfig: CaptureConfig;
  networkFilter: NetworkFilterConfig;
}> {
  const result = await chrome.storage.local.get([KEYS.captureConfig, KEYS.networkFilter]);
  return {
    captureConfig:
      (result[KEYS.captureConfig] as CaptureConfig | undefined) ?? DEFAULT_CAPTURE_CONFIG,
    networkFilter:
      (result[KEYS.networkFilter] as NetworkFilterConfig | undefined) ?? DEFAULT_NETWORK_FILTER,
  };
}

export async function saveSettings(
  captureConfig: CaptureConfig,
  networkFilter: NetworkFilterConfig
): Promise<void> {
  await chrome.storage.local.set({
    [KEYS.captureConfig]: captureConfig,
    [KEYS.networkFilter]: networkFilter,
  });
}
