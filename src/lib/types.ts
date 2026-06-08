export interface CaptureConfig {
  console: boolean;
  network: boolean;
  interactions: boolean;
  domSnapshots: boolean;
  video: boolean;
  fullSelectorPath: boolean;
  autoScreenshotOnInteraction: boolean;
  autoDomSnapshotOnInteraction: boolean;
  zipFolderNesting: boolean;
  zipTitleFilename: boolean;
}

export interface NetworkFilterConfig {
  mode: "xhr-fetch" | "all";
  exclusionPatterns: string[];
  captureRequestBodies: boolean;
  captureXhrFetchResponseBodies: boolean;
  captureOtherResponseBodies: boolean;
  redactAuthHeader: boolean;
  redactCookieHeader: boolean;
  customRedactedHeaders: string[];
}

export type VideoResolution = "720p" | "1080p" | "native";
export type VideoFormat = "auto" | "vp9" | "vp8" | "av1" | "h264";

export interface VideoConfig {
  resolution: VideoResolution;
  frameRate: number; // fps
  bitrate: number; // kbps
  format: VideoFormat;
}

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  console: true,
  network: true,
  interactions: true,
  domSnapshots: true,
  video: false,
  fullSelectorPath: true,
  autoScreenshotOnInteraction: false,
  autoDomSnapshotOnInteraction: false,
  zipFolderNesting: true,
  zipTitleFilename: false,
};

export const DEFAULT_NETWORK_FILTER: NetworkFilterConfig = {
  mode: "xhr-fetch",
  exclusionPatterns: [],
  captureRequestBodies: true,
  captureXhrFetchResponseBodies: true,
  captureOtherResponseBodies: false,
  redactAuthHeader: false,
  redactCookieHeader: false,
  customRedactedHeaders: [],
};

export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  resolution: "720p",
  frameRate: 30,
  bitrate: 1500,
  format: "auto",
};

export interface ScreenshotEntry {
  dataUrl: string;
  annotatedBlob: Blob | null;
}

export interface Session {
  id: string;
  tabId: number;
  tabUrl: string | undefined;
  tabTitle: string | undefined;
  startedAt: number;
  status: "starting" | "recording" | "stopping";
  captureConfig: CaptureConfig;
  debuggerSessionId: string | null;
  domSnapshotCount: number;
  domSnapshotKeys: string[];
  screenshotFilenames: string[];
  videoOpfsFilename: string | null;
}

export interface SessionCounts {
  console: number;
  network: number;
  interactions: number;
  websocket: number;
  sse: number;
  domSnapshots: number;
  screenshots: number;
  errors: number;
}

export interface SubmitFormValues {
  title: string;
  description: string;
  notes: string;
}

export interface RingConfig {
  enabled: boolean;
  dataDurationSec: number;
  videoDurationSec: number;
}

export const DEFAULT_RING_CONFIG: RingConfig = {
  enabled: false,
  dataDurationSec: 300,
  videoDurationSec: 300,
};

export interface RingStatus {
  active: boolean;
  tabId: number | null;
  tabUrl: string | undefined;
  tabTitle: string | undefined;
  oldestEventMs: number | null;
  eventCounts: { console: number; network: number; interactions: number };
  hasVideo: boolean;
}

export interface RingSnapshot {
  id: string;
  tabUrl: string | undefined;
  tabTitle: string | undefined;
  startedAt: number;
  console: unknown[];
  network: unknown[];
  interactions: unknown[];
  videoOpfsFilename: string | null;
}

// Messages between popup/recorder and background
export type BgMessage =
  | { type: "get-session" }
  | { type: "start-session"; captureConfig: CaptureConfig }
  | { type: "stop-session" }
  | { type: "discard-session" }
  | { type: "take-screenshot" }
  | { type: "snapshot-dom" }
  | { type: "get-counts" }
  | { type: "get-settings" }
  | {
      type: "save-settings";
      captureConfig: CaptureConfig;
      networkFilter: NetworkFilterConfig;
      videoConfig: VideoConfig;
    }
  | { type: "get-ring-status" }
  | { type: "toggle-ring"; enabled: boolean }
  | { type: "export-ring" }
  | { type: "save-ring-config"; ringConfig: RingConfig }
  | { type: "get-ring-config" };

export type BgResponse<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
