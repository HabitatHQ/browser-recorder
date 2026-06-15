// Firefox video capture page — opened by background when a session starts on
// Firefox with video enabled. Calls getDisplayMedia (requires a user gesture,
// which the button provides), records to OPFS, and reports back to the
// background when recording is done.

const params = new URLSearchParams(location.search);
const sessionId = params.get("sessionId") ?? "";
const tabTitle = params.get("tabTitle") ?? "the tab you're recording";
const filename = params.get("filename") ?? `chrome-recorder-fx-${sessionId}.webm`;

const root = document.getElementById("root")!;

function render(content: string) {
  root.innerHTML = content;
}

function showIdle() {
  render(`
    <h1>Video capture</h1>
    <p>Click the button, then select <span class="tab-name">${escapeHtml(tabTitle)}</span> in the
       screen picker to start recording.</p>
    <button id="startBtn">Start video capture</button>
  `);
  document.getElementById("startBtn")!.addEventListener("click", startCapture);
}

function showRecording() {
  render(`
    <h1>Video capture</h1>
    <div class="status"><div class="dot"></div>Recording — keep this tab open</div>
    <p>Switch back to <span class="tab-name">${escapeHtml(tabTitle)}</span> and reproduce the bug.
       Stop the session from the extension popup or with <kbd>Alt+Shift+S</kbd>.</p>
  `);
}

function showError(msg: string) {
  render(`
    <h1>Video capture</h1>
    <p class="error">Could not start recording: ${escapeHtml(msg)}</p>
    <button id="retryBtn">Try again</button>
  `);
  document.getElementById("retryBtn")!.addEventListener("click", showIdle);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

let recorder: MediaRecorder | null = null;
let writable: FileSystemWritableFileStream | null = null;
let stopped = false;

async function startCapture() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true,
      // preferCurrentTab hints to the browser to pre-select this tab's opener
      // (the tab the user was on when the session started), reducing clicks.
      // Supported in Firefox 116+; silently ignored in older versions.
      preferCurrentTab: true,
    } as DisplayMediaStreamOptions);

    const dir = await navigator.storage.getDirectory();
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    writable = await fileHandle.createWritable();

    const mimeType = ["video/webm;codecs=vp9", "video/webm"].find((t) =>
      MediaRecorder.isTypeSupported(t)
    );

    recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}) });

    recorder.ondataavailable = async (e) => {
      if (e.data.size > 0 && writable) {
        await writable.write(await e.data.arrayBuffer());
      }
    };

    recorder.onstop = async () => {
      for (const t of stream.getTracks()) t.stop();
      try {
        await writable?.close();
      } finally {
        writable = null;
      }
      chrome.runtime.sendMessage({ type: "fx-video-done", filename });
      window.close();
    };

    recorder.start(5_000);
    showRecording();
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  }
}

// Stop signal from background (sent when stop-session is called).
chrome.runtime.onMessage.addListener((msg: { type?: string }) => {
  if (msg.type === "fx-video-stop" && recorder && !stopped) {
    stopped = true;
    recorder.stop();
  }
  return false;
});

// If the background service worker restarts while this tab is open, we can't
// recover state — just close gracefully so we don't leave a zombie tab.
chrome.runtime.onConnect.addListener(() => {});

showIdle();
