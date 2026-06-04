/// <reference lib="webworker" />

type WorkerMsg =
  | { type: "init"; filename: string }
  | { type: "write"; chunk: ArrayBuffer }
  | { type: "finalize" };

type WorkerReply =
  | { type: "ready" }
  | { type: "written"; bytes: number }
  | { type: "done"; totalBytes: number }
  | { type: "error"; message: string };

export default defineUnlistedScript(() => {
  let handle: FileSystemSyncAccessHandle | null = null;
  let offset = 0;

  self.onmessage = async (e: MessageEvent<WorkerMsg>) => {
    const msg = e.data;
    try {
      switch (msg.type) {
        case "init": {
          const dir = await navigator.storage.getDirectory();
          const fileHandle = await dir.getFileHandle(msg.filename, { create: true });
          handle = await fileHandle.createSyncAccessHandle();
          offset = 0;
          (self as unknown as Worker).postMessage({ type: "ready" } satisfies WorkerReply);
          break;
        }
        case "write": {
          if (!handle) {
            (self as unknown as Worker).postMessage({
              type: "error",
              message: "Not initialized",
            } satisfies WorkerReply);
            break;
          }
          const bytes = new Uint8Array(msg.chunk);
          handle.write(bytes, { at: offset });
          offset += bytes.byteLength;
          (self as unknown as Worker).postMessage({
            type: "written",
            bytes: bytes.byteLength,
          } satisfies WorkerReply);
          break;
        }
        case "finalize": {
          if (handle) {
            handle.flush();
            handle.close();
            handle = null;
          }
          (self as unknown as Worker).postMessage({
            type: "done",
            totalBytes: offset,
          } satisfies WorkerReply);
          break;
        }
      }
    } catch (err) {
      (self as unknown as Worker).postMessage({
        type: "error",
        message: String(err),
      } satisfies WorkerReply);
    }
  };
});
