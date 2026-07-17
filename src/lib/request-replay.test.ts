import type { ReplayRequestInput } from "@browser-recorder/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_REPLAY_BODY, replayInPage } from "./request-replay";

const input = (over: Partial<ReplayRequestInput> = {}): ReplayRequestInput => ({
  method: "GET",
  url: "https://api.example.com/thing",
  headers: {},
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("replayInPage", () => {
  it("shapes a successful response and reports a numeric duration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("hello", { status: 201, headers: { "x-a": "b" } }))
    );
    const out = await replayInPage(input());
    expect(out.outcome).toBe("response");
    if (out.outcome !== "response") throw new Error("expected response");
    expect(out.status).toBe(201);
    expect(out.headers["x-a"]).toBe("b");
    expect(out.body).toBe("hello");
    expect(out.bodyTruncated).toBe(false);
    expect(typeof out.durationMs).toBe("number");
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("sends credentials and never a body on GET", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await replayInPage(input({ method: "get", body: "ignored" }));
    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe("include");
    expect(init.body).toBeUndefined();
    expect(init.method).toBe("GET");
  });

  it("sends the body for a POST", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await replayInPage(input({ method: "POST", body: '{"a":1}' }));
    expect(fetchMock.mock.calls[0][1].body).toBe('{"a":1}');
  });

  it("truncates an over-long response body", async () => {
    const big = "x".repeat(MAX_REPLAY_BODY + 50);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(big))
    );
    const out = await replayInPage(input());
    if (out.outcome !== "response") throw new Error("expected response");
    expect(out.body.length).toBe(MAX_REPLAY_BODY);
    expect(out.bodyTruncated).toBe(true);
  });

  it("returns an error outcome when the fetch is rejected (e.g. CORS)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    const out = await replayInPage(input());
    expect(out.outcome).toBe("error");
    if (out.outcome !== "error") throw new Error("expected error");
    expect(out.error).toContain("Failed to fetch");
    expect(typeof out.durationMs).toBe("number");
  });
});
