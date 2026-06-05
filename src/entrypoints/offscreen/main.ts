// Offscreen document — manages MediaRecorder and OPFS worker for tab video capture

const WARN_BYTES = 100 * 1024 * 1024; // 100 MB
const STOP_BYTES = 500 * 1024 * 1024; // 500 MB

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
  (message: { type: string; streamId?: string; filename?: string }) => {
    if (message.type === "offscreen-start-recording" && message.streamId && message.filename) {
      startRecording(message.streamId, message.filename).catch((err: unknown) => {
        chrome.runtime.sendMessage({ type: "offscreen-error", message: String(err) });
      });
    } else if (message.type === "offscreen-stop-recording") {
      stopRecording();
    } else if (message.type === "offscreen-start-ring" && message.streamId) {
      startRingRecording(message.streamId).catch((err: unknown) => {
        chrome.runtime.sendMessage({ type: "offscreen-error", message: String(err) });
      });
    } else if (message.type === "offscreen-stop-ring") {
      stopRingRecording();
    }
    return false;
  }
);

async function startRecording(streamId: string, filename: string): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // Chrome-specific tabCapture constraint — not in standard TS DOM types
      // @ts-expect-error
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
  });

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

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";

  recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2_000_000,
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

  recorder.start(5_000); // 5s timeslices keep memory bounded
  chrome.runtime.sendMessage({ type: "offscreen-ready" });
}

function stopRecording(): void {
  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
    recorder = null;
  }
}

async function startRingRecording(streamId: string): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      // @ts-expect-error
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    },
  });

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";

  ringRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000 });

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

  ringRecorder.start(2_000);
}

function stopRingRecording(): void {
  if (ringRecorder && ringRecorder.state !== "inactive") {
    ringRecorder.stop();
  }
}
