import { describe, expect, it } from "vitest";
import type { DebuggerPerformanceEvent } from "../src/types.js";
import { summarizePerformance } from "../src/perf-summary.js";

const vital = (
  name: string,
  value: number,
  rating: DebuggerPerformanceEvent["rating"],
  timestamp = 0,
): DebuggerPerformanceEvent => ({
  kind: "performance",
  timestamp,
  metric: "web-vital",
  name,
  value,
  unit: name === "CLS" ? "score" : "ms",
  rating,
});

const longTask = (timestamp: number, durationMs: number): DebuggerPerformanceEvent => ({
  kind: "performance",
  timestamp,
  metric: "long-task",
  name: "longtask",
  value: durationMs,
  unit: "ms",
});

const resource = (name: string, durationMs: number): DebuggerPerformanceEvent => ({
  kind: "performance",
  timestamp: 0,
  metric: "resource",
  name,
  value: durationMs,
  unit: "ms",
  metadata: { transferSize: 1234 },
});

const memory = (timestamp: number, bytes: number): DebuggerPerformanceEvent => ({
  kind: "performance",
  timestamp,
  metric: "memory",
  name: "memory",
  value: bytes,
  unit: "bytes",
});

describe("summarizePerformance", () => {
  it("keeps the latest value per web vital, in canonical order", () => {
    const s = summarizePerformance([
      vital("CLS", 0.05, "good", 10),
      vital("LCP", 2000, "good", 20),
      vital("CLS", 0.3, "poor", 30), // later CLS supersedes the earlier one
    ]);
    expect(s.vitals.map((v) => v.name)).toEqual(["LCP", "CLS"]);
    const cls = s.vitals.find((v) => v.name === "CLS");
    expect(cls).toMatchObject({ value: 0.3, rating: "poor", unit: "score" });
  });

  it("orders vitals LCP, INP, CLS, FCP, TTFB regardless of arrival order", () => {
    const s = summarizePerformance([
      vital("TTFB", 100, "good"),
      vital("FCP", 800, "good"),
      vital("CLS", 0.01, "good"),
      vital("INP", 50, "good"),
      vital("LCP", 1500, "good"),
    ]);
    expect(s.vitals.map((v) => v.name)).toEqual(["LCP", "INP", "CLS", "FCP", "TTFB"]);
  });

  it("returns the longest long tasks descending, capped, with totals", () => {
    const events = Array.from({ length: 15 }, (_, i) => longTask(i, (i + 1) * 10));
    const s = summarizePerformance(events, { cap: 5 });
    expect(s.totals.longTasks).toBe(15);
    expect(s.longTasks).toHaveLength(5);
    expect(s.longTasks[0].durationMs).toBe(150);
    expect(s.longTasks.map((t) => t.durationMs)).toEqual([150, 140, 130, 120, 110]);
  });

  it("returns slowest resources descending and peak heap", () => {
    const s = summarizePerformance([
      resource("a.js", 30),
      resource("b.css", 200),
      resource("c.png", 80),
      memory(0, 1_000_000),
      memory(1, 5_000_000),
      memory(2, 3_000_000),
    ]);
    expect(s.slowestResources[0]).toMatchObject({ name: "b.css", durationMs: 200, transferSize: 1234 });
    expect(s.totals.resources).toBe(3);
    expect(s.peakHeapBytes).toBe(5_000_000);
  });

  it("extracts navigation breakdown from metadata", () => {
    const s = summarizePerformance([
      {
        kind: "performance",
        timestamp: 0,
        metric: "navigation",
        name: "navigation",
        value: 1200,
        unit: "ms",
        metadata: { domContentLoadedMs: 800, loadMs: 1200, ttfbMs: 120 },
      },
    ]);
    expect(s.navigation).toEqual({ domContentLoadedMs: 800, loadMs: 1200, ttfbMs: 120 });
  });

  it("is empty-safe", () => {
    const s = summarizePerformance([]);
    expect(s.vitals).toEqual([]);
    expect(s.longTasks).toEqual([]);
    expect(s.slowestResources).toEqual([]);
    expect(s.peakHeapBytes).toBeNull();
    expect(s.navigation).toBeNull();
    expect(s.totals).toEqual({ longTasks: 0, resources: 0 });
  });
});
