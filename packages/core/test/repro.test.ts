import { describe, expect, it } from "vitest";
import { buildReproSteps } from "../src/repro.js";
import type { DebuggerActionEvent } from "../src/types.js";

const ev = (
  actionType: string,
  metadata: Record<string, unknown> = {},
  target?: string,
): DebuggerActionEvent => ({ kind: "action", timestamp: 0, actionType, target, metadata });

describe("buildReproSteps", () => {
  it("returns an empty string when there are no interactions", () => {
    expect(buildReproSteps([])).toBe("");
  });

  it("numbers each step", () => {
    const steps = buildReproSteps([
      ev("navigation", { path: "/login" }),
      ev("click", { label: "Sign In" }, "button.login"),
      ev("input", { label: "Email", valueLength: 15 }, "input#email"),
    ]);
    const lines = steps.split("\n");
    expect(lines[0]).toMatch(/^1\. /);
    expect(lines[1]).toMatch(/^2\. /);
    expect(lines[2]).toMatch(/^3\. /);
  });

  it("describes navigation, click and input meaningfully", () => {
    const steps = buildReproSteps([
      ev("navigation", { path: "/login" }),
      ev("click", { label: "Sign In" }, "button.login"),
      ev("input", { label: "Email", valueLength: 15 }, "input#email"),
    ]);
    expect(steps).toContain("/login");
    expect(steps).toContain("Sign In");
    expect(steps).toContain("Email");
    expect(steps).toContain("15");
  });

  it("falls back to the selector when no label/text is present", () => {
    expect(buildReproSteps([ev("click", {}, "div.card > button:nth-child(2)")])).toContain(
      "div.card > button:nth-child(2)",
    );
  });

  it("drops noisy keystrokes but keeps Enter/Escape", () => {
    const steps = buildReproSteps([
      ev("keydown", { key: "a" }),
      ev("keydown", { key: "Enter" }),
    ]);
    expect(steps).not.toMatch(/"a"|key a/i);
    expect(steps).toContain("Enter");
    expect(steps.split("\n")).toHaveLength(1);
  });
});
