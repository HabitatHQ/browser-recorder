import { describe, expect, it } from "vitest";
import {
  type ReportData,
  buildEnvironmentBlock,
  buildFullDiagnostics,
  buildIssueUrl,
  failedStages,
  summarizeSettings,
} from "./bug-report";
import type { Diagnostics } from "./diagnostics";
import { DEFAULT_CAPTURE_CONFIG, DEFAULT_NETWORK_FILTER } from "./types";

const HOMEPAGE = "https://github.com/npalladium/chrome-recorder";

function makeData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    env: {
      version: "0.4.0",
      browser: "chrome",
      userAgent: "UA",
      platform: "MacIntel",
    },
    settings: summarizeSettings(DEFAULT_CAPTURE_CONFIG, DEFAULT_NETWORK_FILTER),
    diagnostics: null,
    errorLog: [],
    ...overrides,
  };
}

describe("summarizeSettings", () => {
  it("lists only enabled captures and redacts raw lists to counts", () => {
    const s = summarizeSettings(
      { ...DEFAULT_CAPTURE_CONFIG, video: true },
      {
        ...DEFAULT_NETWORK_FILTER,
        exclusionPatterns: ["/a", "/b"],
        customRedactedHeaders: ["X-Secret"],
      }
    );
    expect(s.captures).toContain("video");
    expect(s.captures).not.toContain("autoScreenshotOnInteraction"); // default false
    expect(s.exclusionPatternCount).toBe(2);
    expect(s.customRedactedHeaderCount).toBe(1);
  });
});

describe("failedStages", () => {
  it("returns only stages marked ok=false", () => {
    const diag: Diagnostics = {
      sessionId: "s",
      startedAt: 0,
      features: {
        replay: {
          inject: { ok: true, count: 1, lastError: null, at: 1 },
          stream: { ok: false, count: 0, lastError: "boom", at: 2 },
        },
      },
      errors: [],
    };
    expect(failedStages(diag)).toEqual(["replay.stream: boom"]);
    expect(failedStages(null)).toEqual([]);
  });
});

describe("buildEnvironmentBlock", () => {
  it("includes version, browser, and last error context", () => {
    const block = buildEnvironmentBlock(
      makeData({
        errorLog: [{ context: "ctx", message: "kaboom", stack: null, at: 1 }],
      })
    );
    expect(block).toContain("Extension version: 0.4.0");
    expect(block).toContain("Browser: chrome");
    expect(block).toContain("Recent internal errors: 1");
    expect(block).toContain("Last error: [ctx] kaboom");
  });
});

describe("buildIssueUrl", () => {
  it("targets the bug template and prefills the environment field", () => {
    const url = buildIssueUrl(HOMEPAGE, "Extension version: 0.4.0");
    expect(url).toContain("github.com/npalladium/chrome-recorder/issues/new");
    expect(url).toContain("template=bug_report.yml");
    expect(url).toContain(`environment=${encodeURIComponent("Extension version: 0.4.0")}`);
  });

  it("tolerates a trailing slash on the homepage URL", () => {
    const url = buildIssueUrl(`${HOMEPAGE}/`, "x");
    expect(url).toContain("chrome-recorder/issues/new?");
    expect(url).not.toContain("chrome-recorder//issues");
  });

  it("truncates an oversized environment block to stay under the URL cap", () => {
    const huge = "x".repeat(50_000);
    const url = buildIssueUrl(HOMEPAGE, huge);
    expect(url.length).toBeLessThanOrEqual(7000);
    expect(decodeURIComponent(url)).toContain("truncated");
  });
});

describe("buildFullDiagnostics", () => {
  it("produces valid JSON containing errors and the redacted settings summary", () => {
    const json = buildFullDiagnostics(
      makeData({ errorLog: [{ context: "c", message: "m", stack: "trace", at: 5 }] })
    );
    const parsed = JSON.parse(json);
    expect(parsed.errors[0]).toMatchObject({ context: "c", message: "m", stack: "trace" });
    expect(parsed.settings).toHaveProperty("captures");
    expect(parsed.environment.version).toBe("0.4.0");
  });
});
