import { describe, expect, it } from "vitest";
import {
  type RingPersistTab,
  type RingRecord,
  decodeRingNdjson,
  encodeRingRecords,
  recordsToTabs,
  tabsToRecords,
} from "./persist";

const rec = (over: Partial<RingRecord> = {}): RingRecord => ({
  t: 1000,
  tab: 1,
  u: "https://app.example.com/x",
  ti: "App",
  ch: "console",
  ev: { kind: "console", message: "hi" },
  ...over,
});

describe("encode/decode round-trip", () => {
  it("encodes to newline-terminated NDJSON and decodes back", () => {
    const records = [rec(), rec({ ch: "network", ev: { kind: "network", url: "/a" } })];
    const text = encodeRingRecords(records);
    expect(text.endsWith("\n")).toBe(true);
    expect(decodeRingNdjson(text)).toEqual(records);
  });

  it("encodes empty input as an empty string", () => {
    expect(encodeRingRecords([])).toBe("");
  });

  it("skips blank and corrupt lines (crash can truncate the last write)", () => {
    const good = encodeRingRecords([rec()]).trim();
    const text = `${good}\n{ this is not json\n\n`;
    const parsed = decodeRingNdjson(text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].tab).toBe(1);
  });

  it("drops records missing required fields", () => {
    const text = `${JSON.stringify({ t: 1, tab: 2 })}\n${JSON.stringify({ ...rec(), ch: "bogus" })}\n`;
    expect(decodeRingNdjson(text)).toEqual([]);
  });
});

describe("recordsToTabs", () => {
  it("groups by tab and channel, dropping events older than the cutoff", () => {
    const records = [
      rec({ tab: 1, t: 500, ch: "console" }), // aged out
      rec({ tab: 1, t: 2000, ch: "console" }),
      rec({ tab: 1, t: 2500, ch: "network" }),
      rec({ tab: 2, t: 3000, ch: "interactions" }),
    ];
    const tabs = recordsToTabs(records, 1000).sort((a, b) => a.tabId - b.tabId);
    expect(tabs).toHaveLength(2);
    expect(tabs[0].console).toHaveLength(1);
    expect(tabs[0].network).toHaveLength(1);
    expect(tabs[0].console[0].timestamp).toBe(2000);
    expect(tabs[1].interactions).toHaveLength(1);
  });

  it("takes url/title/lastActiveMs from the most recent surviving record", () => {
    const records = [
      rec({ tab: 1, t: 2000, u: "https://old.example.com", ti: "Old" }),
      rec({ tab: 1, t: 3000, u: "https://new.example.com", ti: "New" }),
    ];
    const [tab] = recordsToTabs(records, 0);
    expect(tab.url).toBe("https://new.example.com");
    expect(tab.title).toBe("New");
    expect(tab.lastActiveMs).toBe(3000);
  });

  it("sorts events within a channel chronologically", () => {
    const records = [rec({ tab: 1, t: 3000 }), rec({ tab: 1, t: 1000 }), rec({ tab: 1, t: 2000 })];
    const [tab] = recordsToTabs(records, 0);
    expect(tab.console.map((e) => e.timestamp)).toEqual([1000, 2000, 3000]);
  });
});

describe("tabsToRecords (compaction) round-trips through recordsToTabs", () => {
  it("flattens buffers to a sorted record list that regroups identically", () => {
    const tabs: RingPersistTab[] = [
      {
        tabId: 7,
        url: "https://a.example.com",
        title: "A",
        console: [{ timestamp: 100, event: { kind: "console" } }],
        network: [{ timestamp: 50, event: { kind: "network" } }],
        interactions: [],
        performance: [],
        lastActiveMs: 100,
      },
    ];
    const records = tabsToRecords(tabs);
    expect(records.map((r) => r.t)).toEqual([50, 100]); // globally sorted
    const round = recordsToTabs(records, 0);
    expect(round).toEqual(tabs);
  });
});
