// Offscreen document — manages MediaRecorder and OPFS worker for tab video capture

import type { VideoConfig } from "@/lib/types";

const WARN_BYTES = 100 * 1024 * 1024; // 100 MB
const STOP_BYTES = 500 * 1024 * 1024; // 500 MB

// Codec MIME types ordered from most to least preferred per format selection.
const FORMAT_CANDIDATES: Record<VideoConfig["format"], string[]> = {
  auto: ["video/webm;codecs=vp9", "video/webm"],
  vp9: ["video/webm;codecs=vp9", "video/webm"],
  vp8: ["video/webm;codecs=vp8", "video/webm"],
  av1: ["video/webm;codecs=av1", "video/webm;codecs=vp9", "video/webm"],
  h264: ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"],
};

function resolveMimeType(format: VideoConfig["format"]): string {
  const candidates = FORMAT_CANDIDATES[format];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function buildStreamConstraints(streamId: string, config: VideoConfig): MediaStreamConstraints {
  const mandatory: Record<string, unknown> = {
    chromeMediaSource: "tab",
    chromeMediaSourceId: streamId,
    maxFrameRate: config.frameRate,
  };
  if (config.resolution === "720p") {
    mandatory.maxWidth = 1280;
    mandatory.maxHeight = 720;
  } else if (config.resolution === "1080p") {
    mandatory.maxWidth = 1920;
    mandatory.maxHeight = 1080;
  }
  // "native" — no width/height cap; only frameRate is constrained
  return {
    audio: false,
    // @ts-expect-error chromeMediaSource/mandatory not in standard DOM types
    video: { mandatory },
  };
}

type WorkerReply =
  | { type: "ready" }
  | { type: "written"; bytes: number }
  | { type: "done"; totalBytes: number }
  | { type: "error"; message: string };

let recorder: MediaRecorder | null = null;
let opfsWorker: Worker | null = null;
let totalBytes = 0;
let warnedAt100MB = false;

let ringRecorder: MediaRecorder | null = null;

chrome.runtime.onMessage.addListener(
  (message: {
    type: string;
    streamId?: string;
    filename?: string;
    videoConfig?: VideoConfig;
  }) => {
    if (message.type === "offscreen-start-recording" && message.streamId && message.filename) {
      const cfg = message.videoConfig;
      if (!cfg) return false;
      startRecording(message.streamId, message.filename, cfg).catch((err: unknown) => {
        chrome.runtime.sendMessage({ type: "offscreen-error", message: String(err) });
      });
    } else if (message.type === "offscreen-stop-recording") {
      stopRecording();
    } else if (message.type === "offscreen-pause-recording") {
      if (recorder?.state === "recording") recorder.pause();
    } else if (message.type === "offscreen-resume-recording") {
      if (recorder?.state === "paused") recorder.resume();
    } else if (message.type === "offscreen-start-ring" && message.streamId) {
      const cfg = message.videoConfig;
      if (!cfg) return false;
      startRingRecording(message.streamId, cfg).catch((err: unknown) => {
        chrome.runtime.sendMessage({ type: "offscreen-error", message: String(err) });
      });
    } else if (message.type === "offscreen-stop-ring") {
      stopRingRecording();
    }
    return false;
  }
);

async function startRecording(
  streamId: string,
  filename: string,
  videoConfig: VideoConfig
): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia(
    buildStreamConstraints(streamId, videoConfig)
  );

  opfsWorker = new Worker(chrome.runtime.getURL("opfs-worker.js"));
  opfsWorker.postMessage({ type: "init", filename });

  const worker = opfsWorker;
  await new Promise<void>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      if (e.data.type === "ready") resolve();
      else if (e.data.type === "error") reject(new Error(e.data.message));
    };
  });

  // Size monitoring handler after init handshake completes
  opfsWorker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const msg = e.data;
    if (msg.type === "written") {
      totalBytes += msg.bytes;
      if (!warnedAt100MB && totalBytes >= WARN_BYTES) {
        warnedAt100MB = true;
        chrome.runtime.sendMessage({ type: "offscreen-size-warning", megabytes: 100 });
      }
      if (totalBytes >= STOP_BYTES) {
        chrome.runtime.sendMessage({ type: "offscreen-size-warning", megabytes: 500 });
        stopRecording();
      }
    } else if (msg.type === "done") {
      chrome.runtime.sendMessage({
        type: "offscreen-recording-done",
        filename,
        totalBytes: msg.totalBytes,
      });
      opfsWorker?.terminate();
      opfsWorker = null;
    }
  };

  const mimeType = resolveMimeType(videoConfig.format);

  recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: videoConfig.bitrate * 1000,
  });

  recorder.ondataavailable = (e) => {
    if (e.data.size === 0) return;
    e.data.arrayBuffer().then((buf) => {
      opfsWorker?.postMessage({ type: "write", chunk: buf }, [buf]);
    });
  };

  recorder.onstop = () => {
    for (const t of stream.getTracks()) t.stop();
    opfsWorker?.postMessage({ type: "finalize" });
  };

  recorder.start(5_000);
  chrome.runtime.sendMessage({ type: "offscreen-ready" });
}

function stopRecording(): void {
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
    recorder = null;
  }
}

async function startRingRecording(streamId: string, videoConfig: VideoConfig): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia(
    buildStreamConstraints(streamId, videoConfig)
  );

  const mimeType = resolveMimeType(videoConfig.format);

  ringRecorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: videoConfig.bitrate * 1000,
  });

  ringRecorder.ondataavailable = (e) => {
    if (e.data.size === 0) return;
    e.data.arrayBuffer().then((buf) => {
      chrome.runtime.sendMessage({ type: "offscreen-ring-chunk", chunk: buf, mimeType });
    });
  };

  ringRecorder.onstop = () => {
    for (const t of stream.getTracks()) t.stop();
    chrome.runtime.sendMessage({ type: "offscreen-ring-stopped" });
    ringRecorder = null;
  };

  // 5s timeslices — matches regular recording, halves IPC message rate vs 2s
  ringRecorder.start(5_000);
}

function stopRingRecording(): void {
  if (ringRecorder && ringRecorder.state !== "inactive") {
    ringRecorder.stop();
  }
}
