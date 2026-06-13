import { describe, expect, it } from "vitest";
import { applyNetworkEdits } from "../src/network-edit.js";
import type { DebuggerNetworkEvent } from "../src/types.js";

const events: DebuggerNetworkEvent[] = [
  {
    kind: "network",
    timestamp: 10,
    method: "POST",
    url: "https://api/login",
    status: 200,
    requestBody: '{"password":"hunter2","email":"a@b.com"}',
    responseBody: "ok",
    requestHeaders: { authorization: "Bearer abc.def.ghi", accept: "*/*" },
  },
  { kind: "network", timestamp: 20, method: "GET", url: "https://api/secret-doc", status: 200 },
];

describe("applyNetworkEdits", () => {
  it("is a no-op when no edits are given (secrets kept verbatim)", () => {
    const out = applyNetworkEdits(events, {});
    expect(out.network).toEqual(events);
    expect(out.droppedCount).toBe(0);
    expect(out.redactedCount).toBe(0);
  });

  it("drops a request to a tombstone that records it existed", () => {
    const out = applyNetworkEdits(events, { 1: { drop: true } });
    expect(out.droppedCount).toBe(1);
    const tomb = out.network[1];
    expect(tomb.dropped).toBe(true);
    expect(tomb.url).toBe("https://api/secret-doc");
    expect(tomb.method).toBe("GET");
    expect(tomb.status).toBe(200);
    // content fully stripped
    expect(tomb.requestBody).toBeUndefined();
    expect(tomb.responseBody).toBeUndefined();
    expect(tomb.requestHeaders).toBeUndefined();
  });

  it("redacts only the requested fields, leaving others intact", () => {
    const out = applyNetworkEdits(events, {
      0: { redactFields: [{ area: "requestBody" }, { area: "requestHeader", name: "authorization" }] },
    });
    const ev = out.network[0];
    expect(ev.requestBody).not.toContain("hunter2");
    expect(ev.requestBody).not.toContain("a@b.com");
    expect(ev.requestBody).toContain("[REDACTED]");
    expect(ev.requestHeaders?.authorization).toBe("[REDACTED]");
    expect(ev.requestHeaders?.accept).toBe("*/*"); // untouched
    expect(ev.responseBody).toBe("ok"); // not requested → untouched
    expect(out.redactedCount).toBe(2);
  });

  it("does not mutate the input events", () => {
    const snapshot = JSON.parse(JSON.stringify(events));
    applyNetworkEdits(events, { 0: { drop: true }, 1: { redactFields: [{ area: "url" }] } });
    expect(events).toEqual(snapshot);
  });
});
