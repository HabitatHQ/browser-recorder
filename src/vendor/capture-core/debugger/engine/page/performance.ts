import type { DebuggerPerformanceEvent } from "@browser-recorder/core";
import { type Metric, onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";
import type { Reporter } from "./types";

/** Payload the page runtime enqueues; the runtime tags it with kind:"performance". */
export type PerformancePayload = Omit<DebuggerPerformanceEvent, "kind">;

interface PerformanceCaptureInput {
  reporter: Reporter;
  postPerformance: (payload: PerformancePayload) => void;
}

// How often to sample JS heap usage (Chromium only).
const MEMORY_SAMPLE_MS = 2000;
// Long resource/measure entries below this are noise; drop them to keep volume sane.
const MIN_RESOURCE_MS = 1;

/**
 * Capture performance signals via PerformanceObserver + web-vitals, entirely
 * in-page (no chrome.debugger). Each signal is normalized to a
 * DebuggerPerformanceEvent and streamed through the same event queue as console
 * and network. Every observer is individually guarded: a browser that lacks an
 * entry type (e.g. Firefox has no "longtask") simply skips that signal rather
 * than failing the whole runtime. Beta.
 */
export function installPerformanceCapture(input: PerformanceCaptureInput): void {
  const { reporter, postPerformance } = input;

  // PerformanceEntry.startTime is relative to timeOrigin; convert to the same
  // wall-clock epoch the other channels stamp with so the merged timeline lines up.
  const wallClock = (startTime: number) => Math.round(performance.timeOrigin + startTime);

  // --- Core Web Vitals (web-vitals lib) ---------------------------------------
  // reportAllChanges streams running updates (CLS/INP grow over the session); the
  // summary keeps the last value, the timeline shows the progression.
  const reportVital = (metric: Metric) => {
    try {
      postPerformance({
        timestamp: Date.now(),
        metric: "web-vital",
        name: metric.name,
        value: metric.value,
        unit: metric.name === "CLS" ? "score" : "ms",
        rating: metric.rating,
        metadata: { id: metric.id, delta: metric.delta, navigationType: metric.navigationType },
      });
    } catch (error) {
      reporter.reportNonFatalError("Failed to post web-vital event", error);
    }
  };
  try {
    const opts = { reportAllChanges: true };
    onLCP(reportVital, opts);
    onINP(reportVital, opts);
    onCLS(reportVital, opts);
    onFCP(reportVital, opts);
    onTTFB(reportVital, opts);
  } catch (error) {
    reporter.reportNonFatalError("Failed to register web-vitals", error);
  }

  // --- Generic PerformanceObserver helper -------------------------------------
  const observe = (
    type: string,
    handle: (entry: PerformanceEntry) => void,
    extra: PerformanceObserverInit = {}
  ) => {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          try {
            handle(entry);
          } catch (error) {
            reporter.reportNonFatalError(`Failed to handle ${type} entry`, error);
          }
        }
      });
      observer.observe({ type, buffered: true, ...extra });
    } catch {
      // Entry type unsupported in this browser — skip silently.
    }
  };

  // --- Long tasks (>50ms main-thread blocks) ----------------------------------
  observe("longtask", (entry) => {
    postPerformance({
      timestamp: wallClock(entry.startTime),
      metric: "long-task",
      name: "longtask",
      value: Math.round(entry.duration),
      unit: "ms",
    });
  });

  // --- Navigation timing (one per document load) ------------------------------
  observe("navigation", (entry) => {
    const n = entry as PerformanceNavigationTiming;
    postPerformance({
      timestamp: wallClock(n.startTime),
      metric: "navigation",
      name: "navigation",
      value: Math.round(n.loadEventEnd),
      unit: "ms",
      metadata: {
        ttfbMs: Math.round(n.responseStart),
        domContentLoadedMs: Math.round(n.domContentLoadedEventEnd),
        loadMs: Math.round(n.loadEventEnd),
        domInteractiveMs: Math.round(n.domInteractive),
        transferSize: n.transferSize,
        type: n.type,
      },
    });
  });

  // --- Resource timing --------------------------------------------------------
  observe("resource", (entry) => {
    const r = entry as PerformanceResourceTiming;
    if (r.duration < MIN_RESOURCE_MS) return;
    postPerformance({
      timestamp: wallClock(r.startTime),
      metric: "resource",
      name: r.name,
      value: Math.round(r.duration),
      unit: "ms",
      metadata: {
        initiatorType: r.initiatorType,
        transferSize: r.transferSize,
        encodedBodySize: r.encodedBodySize,
        ttfbMs: r.responseStart > 0 ? Math.round(r.responseStart - r.startTime) : undefined,
      },
    });
  });

  // --- User Timing (performance.measure) --------------------------------------
  observe("measure", (entry) => {
    if (entry.duration < MIN_RESOURCE_MS) return;
    postPerformance({
      timestamp: wallClock(entry.startTime),
      metric: "measure",
      name: entry.name,
      value: Math.round(entry.duration),
      unit: "ms",
    });
  });

  // --- JS heap sampling (Chromium only) ---------------------------------------
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    }
  ).memory;
  if (memory) {
    const sample = () => {
      try {
        postPerformance({
          timestamp: Date.now(),
          metric: "memory",
          name: "memory",
          value: memory.usedJSHeapSize,
          unit: "bytes",
          metadata: {
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
          },
        });
      } catch (error) {
        reporter.reportNonFatalError("Failed to sample memory", error);
      }
    };
    sample();
    setInterval(sample, MEMORY_SAMPLE_MS);
  }

  // --- Frame rate (rAF; self-throttles to 0 work when the tab is hidden) ------
  try {
    let frames = 0;
    let windowStart = performance.now();
    const tick = () => {
      frames++;
      const now = performance.now();
      const elapsed = now - windowStart;
      if (elapsed >= 1000) {
        postPerformance({
          timestamp: wallClock(now),
          metric: "frame",
          name: "fps",
          value: Math.round((frames * 1000) / elapsed),
          unit: "fps",
        });
        frames = 0;
        windowStart = now;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (error) {
    reporter.reportNonFatalError("Failed to start frame-rate sampling", error);
  }
}
