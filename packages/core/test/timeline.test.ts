import { describe, expect, it } from "vitest";
import type {
  DebuggerActionEvent,
  DebuggerConsoleEvent,
  DebuggerNetworkEvent,
} from "../src/types.js";
import { buildTimeline } from "../src/timeline.js";

const action = (timestamp: number, target = "#btn"): DebuggerActionEvent => ({
  kind: "action",
  timestamp,
  actionType: "click",
  target,
});
const log = (timestamp: number, message = "hi"): DebuggerConsoleEvent => ({
  kind: "console",
  timestamp,
  level: "log",
  message,
});
const req = (timestamp: number, url = "https://x/api"): DebuggerNetworkEvent => ({
  kind: "network",
  timestamp,
  method: "GET",
  url,
});

describe("buildTimeline", () => {
  it("merges all channels into one timestamp-sorted list with 1-based seq", () => {
    const tl = buildTimeline({
      startedAt: 1000,
      console: [log(1300)],
      network: [req(1100)],
      interactions: [action(1200)],
    });
    expect(tl.map((e) => e.kind)).toEqual(["network", "action", "console"]);
    expect(tl.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("computes offsetMs from startedAt, or null when unknown", () => {
    const tl = buildTimeline({ startedAt: 1000, console: [log(1250)], network: [], interactions: [] });
    expect(tl[0].offsetMs).toBe(250);
    const tl2 = buildTimeline({ startedAt: null, console: [log(1250)], network: [], interactions: [] });
    expect(tl2[0].offsetMs).toBeNull();
  });

  it("breaks timestamp ties deterministically by channel insertion order", () => {
    const tl = buildTimeline({
      startedAt: 0,
      console: [log(500)],
      network: [req(500)],
      interactions: [action(500)],
    });
    // network pushed before interactions before console internally
    expect(tl.map((e) => e.kind)).toEqual(["network", "action", "console"]);
  });

  it("correlates a network event to the nearest preceding interaction within the window", () => {
    const tl = buildTimeline({
      startedAt: 0,
      console: [],
      network: [req(2100)],
      interactions: [action(2000)],
    });
    const click = tl.find((e) => e.kind === "action");
    const net = tl.find((e) => e.kind === "network");
    expect(net?.initiatedBySeq).toBe(click?.seq);
  });

  it("does not correlate beyond the window", () => {
    const tl = buildTimeline(
      { startedAt: 0, console: [], network: [req(20000)], interactions: [action(2000)] },
      { correlationWindowMs: 5000 },
    );
    expect(tl.find((e) => e.kind === "network")?.initiatedBySeq).toBeNull();
  });

  it("never correlates an event to an interaction that comes after it", () => {
    const tl = buildTimeline({
      startedAt: 0,
      console: [log(1000)],
      network: [],
      interactions: [action(2000)],
    });
    expect(tl.find((e) => e.kind === "console")?.initiatedBySeq).toBeNull();
  });

  it("leaves interactions themselves uncorrelated", () => {
    const tl = buildTimeline({ startedAt: 0, console: [], network: [], interactions: [action(1000)] });
    expect(tl[0].initiatedBySeq).toBeNull();
  });
});
