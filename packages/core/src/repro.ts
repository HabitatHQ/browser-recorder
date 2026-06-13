import type { DebuggerActionEvent } from "./types.js";

// Plain typing produces a keydown per character — noise in a repro list. Keep
// only keys that read as deliberate steps.
const KEPT_KEYS = new Set(["Enter", "Escape", "Tab"]);

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function describeStep(ev: DebuggerActionEvent): string | null {
  const meta = ev.metadata ?? {};
  const label = str(meta.label) ?? str(meta.text);
  switch (ev.actionType) {
    case "navigation": {
      const dest = str(meta.path) ?? str(meta.url) ?? str(ev.target);
      return dest ? `Navigate to ${dest}` : "Navigate";
    }
    case "click":
      return `Click ${label ? `"${label}"` : (str(ev.target) ?? "element")}`;
    case "input": {
      const where = label ?? str(ev.target) ?? "a field";
      const len = typeof meta.valueLength === "number" ? ` (${meta.valueLength} chars)` : "";
      return `Type into ${where}${len}`;
    }
    case "change":
      return `Change ${label ?? str(ev.target) ?? "a control"}`;
    case "submit":
      return `Submit ${label ?? str(ev.target) ?? "the form"}`;
    case "keydown": {
      const key = str(meta.key);
      return key && KEPT_KEYS.has(key) ? `Press ${key}` : null;
    }
    default: {
      const where = label ?? str(ev.target);
      return where ? `${ev.actionType} ${where}` : ev.actionType;
    }
  }
}

/**
 * Turn the recorded interaction log into an editable numbered "steps to
 * reproduce" list. Pre-filled into the report Notes so the submitter edits
 * instead of facing a blank box. Returns "" when there's nothing to describe.
 */
export function buildReproSteps(interactions: DebuggerActionEvent[]): string {
  const lines: string[] = [];
  for (const ev of interactions) {
    const step = describeStep(ev);
    if (step) lines.push(`${lines.length + 1}. ${step}`);
  }
  return lines.join("\n");
}
