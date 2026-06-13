import { describe, expect, it } from "vitest";
import { buildReportMd } from "../src/report.js";
import type { ReportInput } from "../src/types.js";

const base: ReportInput = {
  title: "Bug",
  description: "",
  notes: "",
  url: "https://x",
  startedAt: 1000,
  consoleEvents: [],
  networkEvents: [],
  interactions: [],
};

const now = new Date(1000 + 5000);

describe("buildReportMd — Problems section", () => {
  it("surfaces uncaught exceptions and failed requests at the top", () => {
    const md = buildReportMd(
      {
        ...base,
        consoleEvents: [
          { kind: "console", timestamp: 1500, level: "error", message: "[uncaught] TypeError: x" },
        ],
        networkEvents: [
          { kind: "network", timestamp: 1600, method: "POST", url: "https://x/api", status: 500 },
        ],
      },
      now,
    );
    expect(md).toContain("## Problems");
    expect(md).toContain("[uncaught] TypeError: x");
    expect(md).toContain("500");
    // Problems must appear before the Console section.
    expect(md.indexOf("## Problems")).toBeLessThan(md.indexOf("## Console"));
  });

  it("omits the Problems section when nothing went wrong", () => {
    const md = buildReportMd(
      { ...base, consoleEvents: [{ kind: "console", timestamp: 1500, level: "log", message: "ok" }] },
      now,
    );
    expect(md).not.toContain("## Problems");
  });
});

describe("buildReportMd — dropped requests + redaction note", () => {
  it("marks dropped requests and records the redaction summary", () => {
    const md = buildReportMd(
      {
        ...base,
        networkEvents: [
          { kind: "network", timestamp: 1200, method: "GET", url: "https://x/secret", status: 200, dropped: true },
        ],
        redactedFieldCount: 3,
      },
      now,
    );
    expect(md).toContain("dropped");
    expect(md).toMatch(/1 request.*dropped/i);
    expect(md).toMatch(/3 field.*redacted/i);
  });
});
