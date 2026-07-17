import { describe, expect, it } from "vitest";
import { toCurl } from "../src/curl.js";
import type { DebuggerNetworkEvent } from "../src/types.js";

const base = (over: Partial<DebuggerNetworkEvent>): DebuggerNetworkEvent => ({
  kind: "network",
  timestamp: 0,
  method: "GET",
  url: "https://api.example.com/thing",
  ...over,
});

describe("toCurl", () => {
  it("emits a bare GET without -X or a body", () => {
    expect(toCurl(base({}))).toBe("curl 'https://api.example.com/thing'");
  });

  it("includes -X for non-GET methods", () => {
    const out = toCurl(base({ method: "delete", url: "https://api/x" }));
    expect(out).toBe("curl 'https://api/x' \\\n  -X DELETE");
  });

  it("renders one -H per header, preserving insertion order", () => {
    const out = toCurl(
      base({ requestHeaders: { accept: "*/*", "x-trace": "abc" } }),
    );
    expect(out).toBe(
      "curl 'https://api.example.com/thing' \\\n" +
        "  -H 'accept: */*' \\\n" +
        "  -H 'x-trace: abc'",
    );
  });

  it("adds --data-raw and forces -X when a request body is present", () => {
    const out = toCurl(
      base({ method: "POST", url: "https://api/login", requestBody: '{"e":"a@b.com"}' }),
    );
    expect(out).toBe(
      "curl 'https://api/login' \\\n  -X POST \\\n  --data-raw '{\"e\":\"a@b.com\"}'",
    );
  });

  it("forces -X GET when a GET unusually carries a body", () => {
    const out = toCurl(base({ requestBody: "q=1" }));
    expect(out.startsWith("curl 'https://api.example.com/thing' \\\n  -X GET")).toBe(true);
  });

  it("shell-escapes single quotes in url, headers, and body", () => {
    const out = toCurl(
      base({
        method: "POST",
        url: "https://api/x?q=it's",
        requestHeaders: { "x-note": "o'brien" },
        requestBody: "name='eve'",
      }),
    );
    expect(out).toContain("'https://api/x?q=it'\\''s'");
    expect(out).toContain("-H 'x-note: o'\\''brien'");
    expect(out).toContain("--data-raw 'name='\\''eve'\\'''");
  });

  it("treats an empty-string body as no body", () => {
    expect(toCurl(base({ requestBody: "" }))).toBe("curl 'https://api.example.com/thing'");
  });
});
