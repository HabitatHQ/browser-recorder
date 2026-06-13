import { describe, expect, it } from "vitest";
import { redactMatches, scanNetworkEvents, scanText } from "../src/redact.js";
import type { DebuggerNetworkEvent } from "../src/types.js";

const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

describe("scanText", () => {
  it("flags a JWT", () => {
    const m = scanText(`token=${JWT}`);
    expect(m.some((x) => x.kind === "jwt")).toBe(true);
  });

  it("flags an email address", () => {
    const m = scanText("contact alice@example.com please");
    const hit = m.find((x) => x.kind === "email");
    expect(hit?.value).toBe("alice@example.com");
  });

  it("flags secret key/value pairs in JSON and query strings", () => {
    expect(scanText('{"password":"hunter2"}').some((x) => x.kind === "secret-kv")).toBe(true);
    expect(scanText("api_key=ABCDEF123456").some((x) => x.kind === "secret-kv")).toBe(true);
  });

  it("flags a bearer token", () => {
    expect(scanText("Bearer abc.def.ghi-XYZ_123").some((x) => x.kind === "bearer")).toBe(true);
  });

  it("does not flag ordinary prose", () => {
    expect(scanText("the quick brown fox jumps over the lazy dog")).toEqual([]);
  });
});

describe("redactMatches", () => {
  it("replaces matched ranges with [REDACTED] and keeps the rest", () => {
    const text = "user alice@example.com here";
    const out = redactMatches(text, scanText(text));
    expect(out).toBe("user [REDACTED] here");
  });

  it("merges overlapping matches into a single redaction", () => {
    const text = `auth Bearer ${JWT}`;
    const out = redactMatches(text, scanText(text));
    expect(out).not.toContain("eyJ");
    expect((out.match(/\[REDACTED\]/g) ?? []).length).toBe(1);
  });
});

describe("scanNetworkEvents", () => {
  const events: DebuggerNetworkEvent[] = [
    {
      kind: "network",
      timestamp: 1,
      method: "POST",
      url: "https://api/login?api_key=ABCDEF123456",
      requestBody: '{"password":"hunter2"}',
      responseBody: `{"token":"${JWT}"}`,
      requestHeaders: { authorization: "Bearer abc.def.ghi" },
    },
    { kind: "network", timestamp: 2, method: "GET", url: "https://api/health" },
  ];

  it("locates findings per field and skips clean requests", () => {
    const findings = scanNetworkEvents(events);
    const indices = new Set(findings.map((f) => f.eventIndex));
    expect(indices.has(0)).toBe(true);
    expect(indices.has(1)).toBe(false);
    const areas = findings.filter((f) => f.eventIndex === 0).map((f) => f.field.area);
    expect(areas).toContain("url");
    expect(areas).toContain("requestBody");
    expect(areas).toContain("responseBody");
    expect(areas).toContain("requestHeader");
  });
});
