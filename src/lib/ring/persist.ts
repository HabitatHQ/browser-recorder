// Pure serialization for crash-resilient ring buffers. The background streams
// each captured event to an OPFS NDJSON file as a RingRecord; on a service-worker
// suspend or a browser crash/restart the file is read back and regrouped into
// per-tab buffers, dropping anything that has aged out of the rolling window.
// No chrome/OPFS APIs here so the round-trip is unit-tested directly.

export type RingChannel = "console" | "network" | "interactions" | "performance";

export const RING_CHANNELS: RingChannel[] = [
  "console",
  "network",
  "interactions",
  "performance",
];

// One persisted line. Short keys keep the rolling file small.
export interface RingRecord {
  t: number; // event timestamp (ms)
  tab: number; // source tab id
  u: string | null; // tab url at capture time
  ti: string | null; // tab title at capture time
  ch: RingChannel;
  ev: unknown; // the raw debugger event
}

export interface RingPersistEvent {
  timestamp: number;
  event: unknown;
}

export interface RingPersistTab {
  tabId: number;
  url: string | undefined;
  title: string | undefined;
  console: RingPersistEvent[];
  network: RingPersistEvent[];
  interactions: RingPersistEvent[];
  performance: RingPersistEvent[];
  lastActiveMs: number;
}

function isRingChannel(x: unknown): x is RingChannel {
  return typeof x === "string" && (RING_CHANNELS as string[]).includes(x);
}

export function encodeRingRecords(records: RingRecord[]): string {
  if (records.length === 0) return "";
  return `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

// Parse NDJSON, skipping blank or corrupt lines (a crash can truncate the last
// line mid-write, so tolerating garbage is required, not optional).
export function decodeRingNdjson(ndjson: string): RingRecord[] {
  const out: RingRecord[] = [];
  for (const line of ndjson.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const r = JSON.parse(trimmed) as RingRecord;
      if (typeof r.t === "number" && typeof r.tab === "number" && isRingChannel(r.ch)) {
        out.push(r);
      }
    } catch {
      // truncated / corrupt line — skip
    }
  }
  return out;
}

// Regroup records into per-tab buffers, dropping events older than cutoffMs.
// A tab's url/title/lastActiveMs come from its most recent surviving record.
export function recordsToTabs(records: RingRecord[], cutoffMs: number): RingPersistTab[] {
  const byTab = new Map<number, RingPersistTab>();
  for (const r of records) {
    if (r.t < cutoffMs) continue;
    let tab = byTab.get(r.tab);
    if (!tab) {
      tab = {
        tabId: r.tab,
        url: undefined,
        title: undefined,
        console: [],
        network: [],
        interactions: [],
        performance: [],
        lastActiveMs: 0,
      };
      byTab.set(r.tab, tab);
    }
    tab[r.ch].push({ timestamp: r.t, event: r.ev });
    if (r.t >= tab.lastActiveMs) {
      tab.lastActiveMs = r.t;
      tab.url = r.u ?? undefined;
      tab.title = r.ti ?? undefined;
    }
  }
  for (const tab of byTab.values()) {
    for (const ch of RING_CHANNELS) tab[ch].sort((a, b) => a.timestamp - b.timestamp);
  }
  return [...byTab.values()];
}

// Flatten in-memory buffers back to a timestamp-ordered record list, used to
// rewrite (compact) the file so it never grows without bound.
export function tabsToRecords(tabs: RingPersistTab[]): RingRecord[] {
  const out: RingRecord[] = [];
  for (const tab of tabs) {
    for (const ch of RING_CHANNELS) {
      for (const e of tab[ch]) {
        out.push({
          t: e.timestamp,
          tab: tab.tabId,
          u: tab.url ?? null,
          ti: tab.title ?? null,
          ch,
          ev: e.event,
        });
      }
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
