import type { DebuggerPerformanceEvent } from "./types.js";

export interface VitalSummary {
  /** LCP | INP | CLS | FCP | TTFB */
  name: string;
  value: number;
  unit: "ms" | "score";
  rating?: "good" | "needs-improvement" | "poor";
}

export interface LongTaskSummary {
  timestamp: number;
  durationMs: number;
}

export interface ResourceSummary {
  name: string;
  durationMs: number;
  transferSize?: number;
}

export interface NavigationSummary {
  domContentLoadedMs?: number;
  loadMs?: number;
  ttfbMs?: number;
}

export interface PerformanceSummary {
  /** Final reported value per Core Web Vital, in canonical display order. */
  vitals: VitalSummary[];
  /** Longest long tasks, descending, capped. */
  longTasks: LongTaskSummary[];
  /** Slowest resources by duration, descending, capped. */
  slowestResources: ResourceSummary[];
  /** Peak sampled JS heap usage in bytes, or null if memory was not sampled. */
  peakHeapBytes: number | null;
  /** Navigation-timing breakdown, or null if no navigation entry was captured. */
  navigation: NavigationSummary | null;
  totals: { longTasks: number; resources: number };
}

export interface PerformanceSummaryOptions {
  /** Max rows kept for the longTasks / slowestResources lists. */
  cap?: number;
}

// Canonical display order for the vitals scorecard.
const VITAL_ORDER = ["LCP", "INP", "CLS", "FCP", "TTFB"];

const DEFAULT_CAP = 10;

/**
 * Reduce the raw performance event stream into the compact summary the report
 * scorecard renders. Web vitals stream as running updates (reportAllChanges),
 * so the LAST value per metric is the finalized one. Everything else is sorted
 * worst-first and capped so the report stays readable.
 */
export function summarizePerformance(
  events: DebuggerPerformanceEvent[],
  options: PerformanceSummaryOptions = {},
): PerformanceSummary {
  const cap = options.cap ?? DEFAULT_CAP;

  const latestVital = new Map<string, VitalSummary>();
  const longTasks: LongTaskSummary[] = [];
  const resources: ResourceSummary[] = [];
  let peakHeapBytes: number | null = null;
  let navigation: NavigationSummary | null = null;

  for (const ev of events) {
    switch (ev.metric) {
      case "web-vital":
        latestVital.set(ev.name, {
          name: ev.name,
          value: ev.value,
          unit: ev.unit === "score" ? "score" : "ms",
          rating: ev.rating,
        });
        break;
      case "long-task":
        longTasks.push({ timestamp: ev.timestamp, durationMs: ev.value });
        break;
      case "resource": {
        const transferSize = ev.metadata?.transferSize;
        resources.push({
          name: ev.name,
          durationMs: ev.value,
          transferSize: typeof transferSize === "number" ? transferSize : undefined,
        });
        break;
      }
      case "memory":
        if (peakHeapBytes === null || ev.value > peakHeapBytes) peakHeapBytes = ev.value;
        break;
      case "navigation": {
        const m = ev.metadata ?? {};
        navigation = {
          domContentLoadedMs: num(m.domContentLoadedMs),
          loadMs: num(m.loadMs),
          ttfbMs: num(m.ttfbMs),
        };
        break;
      }
      // "measure" and "frame" feed the timeline only; not summarized here.
    }
  }

  const vitals = [...latestVital.values()].sort(
    (a, b) => vitalRank(a.name) - vitalRank(b.name),
  );

  longTasks.sort((a, b) => b.durationMs - a.durationMs);
  resources.sort((a, b) => b.durationMs - a.durationMs);

  return {
    vitals,
    longTasks: longTasks.slice(0, cap),
    slowestResources: resources.slice(0, cap),
    peakHeapBytes,
    navigation,
    totals: { longTasks: longTasks.length, resources: resources.length },
  };
}

function vitalRank(name: string): number {
  const i = VITAL_ORDER.indexOf(name);
  return i === -1 ? VITAL_ORDER.length : i;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
