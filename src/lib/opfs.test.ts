import { afterEach, describe, expect, it, vi } from "vitest";
import { appendBytesToOpfs, writeToOpfs } from "./opfs";

// ─── OPFS mock factory ────────────────────────────────────────────────────────

interface MockWritable {
  write: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface MockFileHandle {
  createWritable: ReturnType<typeof vi.fn>;
  getFile: ReturnType<typeof vi.fn>;
}

interface MockDir {
  getFileHandle: ReturnType<typeof vi.fn>;
}

function makeWritable(overrides: Partial<MockWritable> = {}): MockWritable {
  return {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeFileHandle(
  writableOverrides: Partial<MockWritable> = {},
  fileSize = 0
): MockFileHandle {
  const writable = makeWritable(writableOverrides);
  return {
    createWritable: vi.fn().mockResolvedValue(writable),
    getFile: vi.fn().mockResolvedValue({ size: fileSize }),
  };
}

function makeDir(handleOverrides: Partial<MockFileHandle> = {}, fileSize = 0): MockDir {
  const handle = { ...makeFileHandle({}, fileSize), ...handleOverrides };
  return {
    getFileHandle: vi.fn().mockResolvedValue(handle),
  };
}

function stubStorage(dir: MockDir) {
  vi.stubGlobal("navigator", {
    storage: {
      getDirectory: vi.fn().mockResolvedValue(dir),
    },
  });
}

const BYTES = new Uint8Array([1, 2, 3, 4]);

// ─── writeToOpfs ─────────────────────────────────────────────────────────────

describe("writeToOpfs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("opens the file, writes the buffer, and closes", async () => {
    const writable = makeWritable();
    const handle = makeFileHandle();
    handle.createWritable = vi.fn().mockResolvedValue(writable);
    const dir = makeDir(handle);
    stubStorage(dir);

    await writeToOpfs("test.bin", BYTES);

    expect(dir.getFileHandle).toHaveBeenCalledWith("test.bin", { create: true });
    expect(writable.write).toHaveBeenCalledWith(BYTES.buffer);
    expect(writable.close).toHaveBeenCalledOnce();
  });

  it("propagates rejection from getDirectory()", async () => {
    vi.stubGlobal("navigator", {
      storage: { getDirectory: vi.fn().mockRejectedValue(new Error("quota exceeded")) },
    });

    await expect(writeToOpfs("x.bin", BYTES)).rejects.toThrow("quota exceeded");
  });

  it("propagates rejection from getFileHandle()", async () => {
    const dir: MockDir = {
      getFileHandle: vi.fn().mockRejectedValue(new Error("file locked")),
    };
    stubStorage(dir);

    await expect(writeToOpfs("x.bin", BYTES)).rejects.toThrow("file locked");
  });

  it("propagates rejection from createWritable()", async () => {
    const handle = makeFileHandle({ write: vi.fn() });
    handle.createWritable = vi.fn().mockRejectedValue(new Error("no space"));
    const dir = makeDir(handle);
    stubStorage(dir);

    await expect(writeToOpfs("x.bin", BYTES)).rejects.toThrow("no space");
  });

  it("propagates rejection from writable.write()", async () => {
    const writable = makeWritable({ write: vi.fn().mockRejectedValue(new Error("disk full")) });
    const handle = makeFileHandle();
    handle.createWritable = vi.fn().mockResolvedValue(writable);
    const dir = makeDir(handle);
    stubStorage(dir);

    await expect(writeToOpfs("x.bin", BYTES)).rejects.toThrow("disk full");
  });

  it("propagates rejection from writable.close()", async () => {
    const writable = makeWritable({ close: vi.fn().mockRejectedValue(new Error("flush failed")) });
    const handle = makeFileHandle();
    handle.createWritable = vi.fn().mockResolvedValue(writable);
    const dir = makeDir(handle);
    stubStorage(dir);

    await expect(writeToOpfs("x.bin", BYTES)).rejects.toThrow("flush failed");
  });
});

// ─── appendBytesToOpfs ───────────────────────────────────────────────────────

describe("appendBytesToOpfs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("writes at the current end-of-file position", async () => {
    const writable = makeWritable();
    const handle = makeFileHandle({}, 128);
    handle.createWritable = vi.fn().mockResolvedValue(writable);
    const dir = makeDir(handle);
    stubStorage(dir);

    await appendBytesToOpfs("replay.ndjson", BYTES);

    expect(handle.createWritable).toHaveBeenCalledWith({ keepExistingData: true });
    expect(writable.write).toHaveBeenCalledWith({
      type: "write",
      position: 128,
      data: BYTES,
    });
    expect(writable.close).toHaveBeenCalledOnce();
  });

  it("appends at position 0 when the file is empty (newly created)", async () => {
    const writable = makeWritable();
    const handle = makeFileHandle({}, 0);
    handle.createWritable = vi.fn().mockResolvedValue(writable);
    const dir = makeDir(handle);
    stubStorage(dir);

    await appendBytesToOpfs("replay.ndjson", BYTES);

    expect(writable.write).toHaveBeenCalledWith({ type: "write", position: 0, data: BYTES });
  });

  it("propagates rejection from getDirectory()", async () => {
    vi.stubGlobal("navigator", {
      storage: { getDirectory: vi.fn().mockRejectedValue(new Error("sw suspended")) },
    });

    await expect(appendBytesToOpfs("r.ndjson", BYTES)).rejects.toThrow("sw suspended");
  });

  it("propagates rejection from getFileHandle()", async () => {
    const dir: MockDir = {
      getFileHandle: vi.fn().mockRejectedValue(new Error("no permission")),
    };
    stubStorage(dir);

    await expect(appendBytesToOpfs("r.ndjson", BYTES)).rejects.toThrow("no permission");
  });

  it("propagates rejection from createWritable()", async () => {
    const handle = makeFileHandle();
    handle.createWritable = vi.fn().mockRejectedValue(new Error("locked"));
    const dir = makeDir(handle);
    stubStorage(dir);

    await expect(appendBytesToOpfs("r.ndjson", BYTES)).rejects.toThrow("locked");
  });

  it("propagates rejection from writable.write()", async () => {
    const writable = makeWritable({ write: vi.fn().mockRejectedValue(new Error("io error")) });
    const handle = makeFileHandle();
    handle.createWritable = vi.fn().mockResolvedValue(writable);
    const dir = makeDir(handle);
    stubStorage(dir);

    await expect(appendBytesToOpfs("r.ndjson", BYTES)).rejects.toThrow("io error");
  });

  it("propagates rejection from writable.close()", async () => {
    const writable = makeWritable({ close: vi.fn().mockRejectedValue(new Error("close fail")) });
    const handle = makeFileHandle();
    handle.createWritable = vi.fn().mockResolvedValue(writable);
    const dir = makeDir(handle);
    stubStorage(dir);

    await expect(appendBytesToOpfs("r.ndjson", BYTES)).rejects.toThrow("close fail");
  });
});

// ─── Promise-chain serialization (the replay write chain pattern) ─────────────
// Simulates the pattern in background.ts: appendBytesToOpfs calls are chained
// via a promise so concurrent events don't interleave. A mid-chain failure must
// not block subsequent writes.

describe("replay write chain (adversarial)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("serializes concurrent appends without interleaving", async () => {
    const order: number[] = [];

    // Each call takes a different synthetic delay to prove ordering is by chain, not by speed.
    let callCount = 0;
    const dir: MockDir = {
      getFileHandle: vi.fn().mockImplementation(() => {
        const id = ++callCount;
        return new Promise((resolve) =>
          setTimeout(
            () => {
              order.push(id);
              resolve(makeFileHandle());
            },
            id === 1 ? 20 : id === 2 ? 5 : 1
          )
        );
      }),
    };
    stubStorage(dir);

    let chain = Promise.resolve();
    for (let i = 1; i <= 3; i++) {
      chain = chain.then(() => appendBytesToOpfs("r.ndjson", BYTES));
    }
    await chain;

    // Calls must complete in insertion order despite differing delays.
    expect(order).toEqual([1, 2, 3]);
  });

  it("a failed append does not block subsequent writes", async () => {
    let callCount = 0;
    const writtenIds: number[] = [];

    const dir: MockDir = {
      getFileHandle: vi.fn().mockImplementation(() => {
        const id = ++callCount;
        if (id === 2) {
          return Promise.reject(new Error("transient failure"));
        }
        writtenIds.push(id);
        return Promise.resolve(makeFileHandle());
      }),
    };
    stubStorage(dir);

    let chain = Promise.resolve();
    const results: Array<"ok" | "err"> = [];

    for (let i = 1; i <= 3; i++) {
      chain = chain
        .then(() => appendBytesToOpfs("r.ndjson", BYTES))
        .then(() => {
          results.push("ok");
        })
        .catch(() => {
          results.push("err");
        });
    }
    await chain;

    // Call 2 fails; calls 1 and 3 succeed.
    expect(results).toEqual(["ok", "err", "ok"]);
    expect(writtenIds).toEqual([1, 3]);
  });

  it("all appends fail gracefully when the storage root is unavailable", async () => {
    vi.stubGlobal("navigator", {
      storage: { getDirectory: vi.fn().mockRejectedValue(new Error("opfs unavailable")) },
    });

    let chain = Promise.resolve();
    const results: string[] = [];

    for (let i = 0; i < 3; i++) {
      chain = chain
        .then(() => appendBytesToOpfs("r.ndjson", BYTES))
        .catch((err: Error) => {
          results.push(err.message);
        });
    }
    await chain;

    expect(results).toHaveLength(3);
    expect(results.every((m) => m === "opfs unavailable")).toBe(true);
  });
});
