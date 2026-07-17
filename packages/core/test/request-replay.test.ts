import { describe, expect, it } from "vitest";
import { headersToText, parseHeadersText, seedReplayInput } from "../src/request-replay.js";
import type { DebuggerNetworkEvent } from "../src/types.js";

describe("seedReplayInput", () => {
  it("copies method, url, headers, and body from a captured entry", () => {
    const ev: DebuggerNetworkEvent = {
      kind: "network",
      timestamp: 0,
      method: "POST",
      url: "https://api/x",
      requestHeaders: { accept: "*/*" },
      requestBody: '{"a":1}',
    };
    expect(seedReplayInput(ev)).toEqual({
      method: "POST",
      url: "https://api/x",
      headers: { accept: "*/*" },
      body: '{"a":1}',
    });
  });

  it("clones headers so editing the seed can't mutate the capture", () => {
    const ev: DebuggerNetworkEvent = {
      kind: "network",
      timestamp: 0,
      method: "GET",
      url: "https://api/x",
      requestHeaders: { a: "1" },
    };
    const seed = seedReplayInput(ev);
    seed.headers.a = "mutated";
    expect(ev.requestHeaders).toEqual({ a: "1" });
  });

  it("defaults an empty headers map and falls back to GET", () => {
    const seed = seedReplayInput({ kind: "network", timestamp: 0, method: "", url: "https://x" });
    expect(seed).toEqual({ method: "GET", url: "https://x", headers: {}, body: undefined });
  });
});

describe("headersToText / parseHeadersText", () => {
  it("round-trips a header map", () => {
    const headers = { "content-type": "application/json", "x-trace": "abc" };
    expect(parseHeadersText(headersToText(headers))).toEqual(headers);
  });

  it("splits only on the first colon so values keep theirs", () => {
    expect(parseHeadersText("x-url: https://a.b/c?d=1")).toEqual({
      "x-url": "https://a.b/c?d=1",
    });
  });

  it("skips blank and colon-less lines and trims names/values", () => {
    expect(parseHeadersText("\n  Accept :  */*  \ngarbage\n")).toEqual({ Accept: "*/*" });
  });
});
