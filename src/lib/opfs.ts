/**
 * Writes bytes to an OPFS file, replacing any existing contents.
 */
export async function writeToOpfs(filename: string, bytes: Uint8Array): Promise<void> {
  const dir = await navigator.storage.getDirectory();
  const handle = await dir.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  // Buffer is always a plain ArrayBuffer here; cast avoids the ArrayBufferLike widening.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writable.write(bytes.buffer as ArrayBuffer);
  await writable.close();
}

/**
 * Reads an OPFS file as text, returning null if it does not exist.
 */
export async function readOpfsText(filename: string): Promise<string | null> {
  try {
    const dir = await navigator.storage.getDirectory();
    const handle = await dir.getFileHandle(filename);
    const file = await handle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

/**
 * Deletes an OPFS file if present; a no-op otherwise.
 */
export async function removeFromOpfs(filename: string): Promise<void> {
  try {
    const dir = await navigator.storage.getDirectory();
    await dir.removeEntry(filename);
  } catch {
    // already gone
  }
}

/**
 * Appends bytes to the end of an OPFS file, creating it if absent.
 */
export async function appendBytesToOpfs(filename: string, bytes: Uint8Array): Promise<void> {
  const dir = await navigator.storage.getDirectory();
  const handle = await dir.getFileHandle(filename, { create: true });
  const file = await handle.getFile();
  const writable = await handle.createWritable({ keepExistingData: true });
  // Cast to Uint8Array<ArrayBuffer> — the DOM type requires ArrayBuffer, not the
  // wider ArrayBufferLike that Uint8Array's generic defaults to.
  await writable.write({
    type: "write",
    position: file.size,
    data: bytes as Uint8Array<ArrayBuffer>,
  });
  await writable.close();
}
