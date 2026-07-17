import { buildTimeline, toCurl } from "@browser-recorder/core";
import { describe, expect, it } from "vitest";
import { buildReportHtml } from "./report-html";

const baseInput = {
  title: "Login bug",
  url: "https://example.com/login",
  durationMs: 5000,
  recordedIso: "2026-06-13T14:00:00.000Z",
  device: { browser: "UA", os: "macOS", viewport: { width: 1280, height: 800 } },
  performance: null,
  screenshots: [],
  domSnapshots: [],
  video: null,
  replay: null,
};

describe("buildReportHtml", () => {
  it("emits a self-contained HTML document carrying the title and the timeline data", () => {
    const timeline = buildTimeline({
      startedAt: 0,
      console: [{ kind: "console", timestamp: 100, level: "error", message: "boom" }],
      network: [{ kind: "network", timestamp: 200, method: "GET", url: "https://x", status: 500 }],
      interactions: [{ kind: "action", timestamp: 50, actionType: "click", target: "#b" }],
    });
    const html = buildReportHtml({ ...baseInput, timeline });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Report — Login bug</title>");
    // The timeline (rendered client-side) is inlined as data with seq/offset.
    expect(html).toContain('"seq":1');
    expect(html).toContain('"initiatedBySeq"');
    expect(html).toContain("boom");
  });

  it("escapes captured markup so page content can't break out of the data <script>", () => {
    const timeline = buildTimeline({
      startedAt: 0,
      console: [
        {
          kind: "console",
          timestamp: 100,
          level: "log",
          message: "</script><script>alert(1)</script>",
        },
      ],
      network: [],
      interactions: [],
    });
    const html = buildReportHtml({ ...baseInput, timeline });
    // The injected closing tag must be neutralised; a raw </script> before our
    // own closing tag would terminate the data block early.
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("\\u003c/script>");
  });

  it("renders the empty-state when nothing was captured", () => {
    const html = buildReportHtml({ ...baseInput, timeline: [] });
    expect(html).toContain("No timeline events were captured");
  });

  it("renders the performance scorecard when a summary is provided", () => {
    const html = buildReportHtml({
      ...baseInput,
      timeline: [],
      performance: {
        vitals: [{ name: "LCP", value: 2500, unit: "ms", rating: "needs-improvement" }],
        longTasks: [{ timestamp: 0, durationMs: 180 }],
        slowestResources: [{ name: "https://x/app.js", durationMs: 420 }],
        peakHeapBytes: 5_000_000,
        navigation: { loadMs: 1200 },
        totals: { longTasks: 1, resources: 1 },
      },
    });
    expect(html).toContain(">Performance<");
    expect(html).toContain("LCP");
    expect(html).toContain('"peakHeapBytes":5000000');
  });

  it("emits an inline viewer script that is syntactically valid JS", () => {
    const html = buildReportHtml({ ...baseInput, timeline: [] });
    // The viewer logic runs only when a user opens the file; compile it here so a
    // syntax error is caught in CI instead. new Function() parses without running.
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const viewer = scripts.find((s) => s.includes("window.__report") && s.includes("function"));
    expect(viewer).toBeTruthy();
    expect(() => new Function(viewer as string)).not.toThrow();
  });

  it("renders a copy-as-curl button on kept network rows", () => {
    const timeline = buildTimeline({
      startedAt: 0,
      console: [],
      network: [{ kind: "network", timestamp: 200, method: "GET", url: "https://x", status: 200 }],
      interactions: [],
    });
    const html = buildReportHtml({ ...baseInput, timeline });
    expect(html).toContain('class="curl-btn"');
  });

  it("inlines a toCurl twin that matches the core implementation (guards escaping drift)", () => {
    const html = buildReportHtml({ ...baseInput, timeline: [] });
    // Extract the inlined shQuote+toCurl pair and run it, so a divergence from
    // packages/core (especially shell-escaping) fails here instead of silently
    // producing a broken command in the report.
    const src = html.match(/function shQuote[\s\S]*?return parts\.join\([^;]*\);\s*\}/)?.[0];
    expect(src).toBeTruthy();
    const inlineToCurl = new Function(`${src}; return toCurl;`)() as typeof toCurl;
    const ev = {
      kind: "network" as const,
      timestamp: 0,
      method: "POST",
      url: "https://api/x?q=it's",
      requestHeaders: { "x-note": "o'brien", accept: "*/*" },
      requestBody: "name='eve'",
    };
    expect(inlineToCurl(ev)).toBe(toCurl(ev));
  });
});
