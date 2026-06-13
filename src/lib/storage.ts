import {
  type CaptureConfig,
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_NETWORK_FILTER,
  DEFAULT_RING_CONFIG,
  DEFAULT_VIDEO_CONFIG,
  type NetworkFilterConfig,
  type RingConfig,
  type RingSnapshot,
  type Session,
  type SessionCounts,
  type VideoConfig,
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

// Standalone screenshot OPFS filename — uses the same slug-based convention as
// the zip export so the user sees a consistent name if they inspect the file.
export function standaloneScreenshotOpfsFilename(slug: string): string {
  return `${OPFS_PREFIX}screenshot-${slug}.png`;
}

// Standalone (non-session) DOM snapshot OPFS filename.
export function standaloneDomSnapshotOpfsFilename(slug: string): string {
  return `${OPFS_PREFIX}dom-${slug}.html`;
}

// rrweb replay events JSON for a session (experimental).
export function replayOpfsFilename(sessionId: string): string {
  return `${OPFS_PREFIX}replay-${sessionId}.json`;
}

const KEYS = {
  session: "session",
  counts: "counts",
  captureConfig: "captureConfig",
  networkFilter: "networkFilter",
  videoConfig: "videoConfig",
  // OPFS filenames for standalone (non-session) screenshots
  screenshotFilenames: "screenshotFilenames",
  // OPFS filenames for standalone (non-session) DOM snapshots
  domSnapshotFilenames: "domSnapshotFilenames",
  ringConfig: "ringConfig",
  ringSnapshot: "ringSnapshot",
} as const;

// Session state lives in chrome.storage.session (cleared on browser restart)
export async function getSession(): Promise<Session | null> {
  const result = await chrome.storage.session.get(KEYS.session);
  return (result[KEYS.session] as Session | undefined) ?? null;
}

export async function setSession(session: Session | null): Promise<void> {
  if (session === null) {
    await chrome.storage.session.remove([
      KEYS.session,
      KEYS.counts,
      KEYS.screenshotFilenames,
      KEYS.domSnapshotFilenames,
    ]);
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
      websocket: 0,
      sse: 0,
      domSnapshots: 0,
      screenshots: 0,
      errors: 0,
    }
  );
}

export async function saveCounts(counts: SessionCounts): Promise<void> {
  await chrome.storage.session.set({ [KEYS.counts]: counts });
}

// Standalone (non-session) screenshots — stored as OPFS filenames, not data URLs,
// to stay within chrome.storage.session's 10 MB quota.
export async function appendStandaloneScreenshotFilename(filename: string): Promise<void> {
  const existing = await getStandaloneScreenshotFilenames();
  await chrome.storage.session.set({ [KEYS.screenshotFilenames]: [...existing, filename] });
}

export async function getStandaloneScreenshotFilenames(): Promise<string[]> {
  const result = await chrome.storage.session.get(KEYS.screenshotFilenames);
  return (result[KEYS.screenshotFilenames] as string[] | undefined) ?? [];
}

// Standalone (non-session) DOM snapshots — stored as OPFS filenames, mirroring
// the standalone screenshot handling.
export async function appendStandaloneDomSnapshotFilename(filename: string): Promise<void> {
  const existing = await getStandaloneDomSnapshotFilenames();
  await chrome.storage.session.set({ [KEYS.domSnapshotFilenames]: [...existing, filename] });
}

export async function getStandaloneDomSnapshotFilenames(): Promise<string[]> {
  const result = await chrome.storage.session.get(KEYS.domSnapshotFilenames);
  return (result[KEYS.domSnapshotFilenames] as string[] | undefined) ?? [];
}

// Settings live in chrome.storage.local (persistent)
export async function getSettings(): Promise<{
  captureConfig: CaptureConfig;
  networkFilter: NetworkFilterConfig;
  videoConfig: VideoConfig;
}> {
  const result = await chrome.storage.local.get([
    KEYS.captureConfig,
    KEYS.networkFilter,
    KEYS.videoConfig,
  ]);
  return {
    captureConfig: {
      ...DEFAULT_CAPTURE_CONFIG,
      ...(result[KEYS.captureConfig] as CaptureConfig | undefined),
    },
    networkFilter: {
      ...DEFAULT_NETWORK_FILTER,
      ...(result[KEYS.networkFilter] as NetworkFilterConfig | undefined),
    },
    videoConfig: {
      ...DEFAULT_VIDEO_CONFIG,
      ...(result[KEYS.videoConfig] as VideoConfig | undefined),
    },
  };
}

export async function saveSettings(
  captureConfig: CaptureConfig,
  networkFilter: NetworkFilterConfig,
  videoConfig: VideoConfig
): Promise<void> {
  await chrome.storage.local.set({
    [KEYS.captureConfig]: captureConfig,
    [KEYS.networkFilter]: networkFilter,
    [KEYS.videoConfig]: videoConfig,
  });
}

export async function getRingConfig(): Promise<RingConfig> {
  const result = await chrome.storage.local.get(KEYS.ringConfig);
  return (result[KEYS.ringConfig] as RingConfig | undefined) ?? DEFAULT_RING_CONFIG;
}

export async function saveRingConfig(ringConfig: RingConfig): Promise<void> {
  await chrome.storage.local.set({ [KEYS.ringConfig]: ringConfig });
}

export async function setRingSnapshot(snapshot: RingSnapshot | null): Promise<void> {
  if (snapshot === null) {
    await chrome.storage.session.remove(KEYS.ringSnapshot);
  } else {
    await chrome.storage.session.set({ [KEYS.ringSnapshot]: snapshot });
  }
}

export async function getRingSnapshot(): Promise<RingSnapshot | null> {
  const result = await chrome.storage.session.get(KEYS.ringSnapshot);
  return (result[KEYS.ringSnapshot] as RingSnapshot | undefined) ?? null;
}
