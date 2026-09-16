import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileNetworkCapturePolicy, filterHeaderRecord, shouldCaptureNetworkUrl } from "./policy";

const policy = (overrides: Record<string, unknown> = {}) =>
  compileNetworkCapturePolicy({
    exclusionPatterns: [],
    captureRequestBodies: true,
    captureXhrFetchResponseBodies: true,
    customRedactedHeaders: [],
    ...overrides,
  });

describe("network capture policy", () => {
  it("gives URL exclusions precedence over capture", () => {
    const compiled = policy({
      exclusionPatterns: ["*/analytics/*", "https://api.example.com/health"],
    });

    expect(shouldCaptureNetworkUrl(compiled, "https://app.example.com/analytics/hit")).toBe(false);
    expect(shouldCaptureNetworkUrl(compiled, "https://api.example.com/health")).toBe(false);
    expect(shouldCaptureNetworkUrl(compiled, "https://api.example.com/users")).toBe(true);
  });

  it("protects built-in and configured headers case-insensitively", () => {
    const compiled = policy({ customRedactedHeaders: ["X-Tenant-Secret"] });

    expect(
      filterHeaderRecord(compiled, {
        Authorization: "Bearer secret",
        COOKIE: "sid=secret",
        "X-Tenant-Secret": "tenant-secret",
        Accept: "application/json",
      })
    ).toEqual({ Accept: "application/json" });
  });

  it("retains body controls in the effective policy", () => {
    const compiled = policy({ captureRequestBodies: false, captureXhrFetchResponseBodies: false });

    expect(compiled.captureRequestBodies).toBe(false);
    expect(compiled.captureResponseBodies).toBe(false);
  });

  it("treats every exact URL pattern as excluded", () => {
    fc.assert(
      fc.property(fc.webUrl(), (url) => {
        expect(shouldCaptureNetworkUrl(policy({ exclusionPatterns: [url] }), url)).toBe(false);
      })
    );
  });
});
