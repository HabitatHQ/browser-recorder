import { describe, expect, it } from "vitest";
import {
  type RingScopeConfig,
  evaluateRingScope,
  hostFromUrl,
  hostMatchesAny,
  hostMatchesPattern,
  isBrowserInternal,
} from "./scope";

const scope = (over: Partial<RingScopeConfig> = {}): RingScopeConfig => ({
  mode: "allowlist",
  allow: [],
  block: [],
  ...over,
});

describe("hostFromUrl", () => {
  it("extracts the hostname, lowercased", () => {
    expect(hostFromUrl("https://App.Example.com/path?q=1")).toBe("app.example.com");
    expect(hostFromUrl("http://localhost:3000/")).toBe("localhost");
  });
  it("returns null for junk / missing urls", () => {
    expect(hostFromUrl(undefined)).toBeNull();
    expect(hostFromUrl("")).toBeNull();
    expect(hostFromUrl("not a url")).toBeNull();
  });
});

describe("isBrowserInternal", () => {
  it("flags browser-internal and extension pages", () => {
    for (const u of [
      "chrome://settings",
      "about:blank",
      "edge://flags",
      "chrome-extension://abc/recorder.html",
      "chrome-untrusted://foo",
      "devtools://devtools/bundled/inspector.html",
      "view-source:https://example.com",
      undefined,
      "",
    ]) {
      expect(isBrowserInternal(u)).toBe(true);
    }
  });
  it("does not flag normal web pages", () => {
    expect(isBrowserInternal("https://example.com")).toBe(false);
    expect(isBrowserInternal("http://localhost:3000")).toBe(false);
  });
});

describe("hostMatchesPattern", () => {
  it("matches exact hosts case-insensitively", () => {
    expect(hostMatchesPattern("example.com", "example.com")).toBe(true);
    expect(hostMatchesPattern("EXAMPLE.com", "example.COM")).toBe(true);
    expect(hostMatchesPattern("app.example.com", "example.com")).toBe(false);
  });
  it("treats * as any run of characters", () => {
    expect(hostMatchesPattern("a.staging.example.com", "*.staging.example.com")).toBe(true);
    expect(hostMatchesPattern("a.b.staging.example.com", "*.staging.example.com")).toBe(true);
    // bare apex is not matched by a leading-label wildcard
    expect(hostMatchesPattern("staging.example.com", "*.staging.example.com")).toBe(false);
    expect(hostMatchesPattern("anything.at.all", "*")).toBe(true);
  });
  it("does not let dots in the host act as regex wildcards", () => {
    expect(hostMatchesPattern("exampleXcom", "example.com")).toBe(false);
  });
});

describe("hostMatchesAny", () => {
  it("is true when any pattern matches", () => {
    expect(hostMatchesAny("app.example.com", ["foo.com", "*.example.com"])).toBe(true);
    expect(hostMatchesAny("app.example.com", ["foo.com", "bar.com"])).toBe(false);
    expect(hostMatchesAny("app.example.com", [])).toBe(false);
  });
});

describe("evaluateRingScope", () => {
  it("never records browser-internal pages, even in 'all' mode", () => {
    expect(evaluateRingScope("chrome://settings", scope({ mode: "all" }), [])).toEqual({
      recordable: false,
      reason: "internal",
    });
  });

  it("blocklist always wins — over allow, over pin, over mode", () => {
    const s = scope({ mode: "all", allow: ["mail.example.com"], block: ["mail.example.com"] });
    expect(evaluateRingScope("https://mail.example.com", s, ["mail.example.com"])).toEqual({
      recordable: false,
      reason: "blocked",
    });
  });

  it("pin overrides an allowlist miss but not a block", () => {
    const s = scope({ mode: "allowlist", allow: ["app.example.com"] });
    expect(evaluateRingScope("https://docs.example.com", s, ["docs.example.com"])).toEqual({
      recordable: true,
      reason: "pinned",
    });
  });

  it("allowlist mode: empty list records nothing with a distinct reason", () => {
    expect(evaluateRingScope("https://example.com", scope({ allow: [] }), [])).toEqual({
      recordable: false,
      reason: "empty-allowlist",
    });
  });

  it("allowlist mode: records only listed domains", () => {
    const s = scope({ mode: "allowlist", allow: ["app.example.com"] });
    expect(evaluateRingScope("https://app.example.com/x", s, [])).toEqual({
      recordable: true,
      reason: "allowed",
    });
    expect(evaluateRingScope("https://other.com", s, [])).toEqual({
      recordable: false,
      reason: "not-in-allowlist",
    });
  });

  it("blocklist mode: records everything except blocked", () => {
    const s = scope({ mode: "blocklist", block: ["mail.example.com"] });
    expect(evaluateRingScope("https://anything.com", s, [])).toEqual({
      recordable: true,
      reason: "blocklist-mode",
    });
    expect(evaluateRingScope("https://mail.example.com", s, [])).toEqual({
      recordable: false,
      reason: "blocked",
    });
  });

  it("all mode: records everything not blocked", () => {
    expect(evaluateRingScope("https://anything.com", scope({ mode: "all" }), [])).toEqual({
      recordable: true,
      reason: "all-mode",
    });
  });

  it("treats an unparseable url as internal (nothing to record)", () => {
    expect(evaluateRingScope("not a url", scope({ mode: "all" }), [])).toEqual({
      recordable: false,
      reason: "internal",
    });
  });
});
