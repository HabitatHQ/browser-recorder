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
          // msg.chunk is a transferred ArrayBuffer — write directly without wrapping
          // in Uint8Array to avoid an unnecessary allocation per chunk.
          const byteLength = msg.chunk.byteLength;
          handle.write(msg.chunk, { at: offset });
          offset += byteLength;
          (self as unknown as Worker).postMessage({
            type: "written",
            bytes: byteLength,
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
