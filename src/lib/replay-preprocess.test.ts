import { describe, expect, it } from "vitest";
import { stripReplayAutofocus } from "./replay-preprocess";

// Minimal serialized-node helpers mirroring rrweb's snapshot shape. Typed as
// `any` so tests can index into the opaque event structure freely.
// biome-ignore lint/suspicious/noExplicitAny: test fixtures mirror untyped rrweb JSON.
type Any = any;
function el(tagName: string, attributes: Record<string, unknown>, childNodes: unknown[] = []): Any {
  return { type: 2, tagName, attributes, childNodes };
}
function fullSnapshot(root: unknown): Any {
  return { type: 2, data: { node: root }, timestamp: 1 };
}
function mutation(data: Record<string, unknown>): Any {
  return { type: 3, data: { source: 0, ...data }, timestamp: 2 };
}

describe("stripReplayAutofocus", () => {
  it("removes autofocus from a FullSnapshot node tree, regardless of tag", () => {
    const events = [
      fullSnapshot(
        el("form", {}, [
          el("input", { autofocus: "", type: "text" }),
          el("textarea", { autofocus: "autofocus" }),
          el("button", { autofocus: true }),
        ])
      ),
    ];
    const [snap] = stripReplayAutofocus(events) as [ReturnType<typeof fullSnapshot>];
    const [input, textarea, button] = snap.data.node.childNodes;
    expect(input.attributes).toEqual({ type: "text" });
    expect("autofocus" in textarea.attributes).toBe(false);
    expect("autofocus" in button.attributes).toBe(false);
  });

  it("removes autofocus from mutation adds and attribute mutations", () => {
    const events = [
      mutation({
        adds: [{ parentId: 1, nextId: null, node: el("input", { autofocus: "" }) }],
        attributes: [{ id: 5, attributes: { autofocus: "", value: "x" } }],
      }),
    ];
    const [m] = stripReplayAutofocus(events) as [ReturnType<typeof mutation>];
    expect("autofocus" in m.data.adds[0].node.attributes).toBe(false);
    expect(m.data.attributes[0].attributes).toEqual({ value: "x" });
  });

  it("does not mutate the input array (DOM events are cloned, not edited in place)", () => {
    const original = fullSnapshot(el("input", { autofocus: "" }));
    const events = [original];
    const result = stripReplayAutofocus(events);
    // Original retains autofocus; result does not.
    expect(original.data.node.attributes.autofocus).toBe("");
    expect("autofocus" in (result[0] as typeof original).data.node.attributes).toBe(false);
    expect(result[0]).not.toBe(original);
  });

  it("passes non-DOM events through by reference (no needless cloning)", () => {
    const mouseMove = { type: 3, data: { source: 1, positions: [] }, timestamp: 3 };
    const meta = { type: 4, data: { width: 800, height: 600 }, timestamp: 0 };
    const result = stripReplayAutofocus([mouseMove, meta]);
    expect(result[0]).toBe(mouseMove);
    expect(result[1]).toBe(meta);
  });

  it("leaves events without autofocus structurally equal", () => {
    const events = [fullSnapshot(el("div", { class: "x" }, [el("span", {})]))];
    const result = stripReplayAutofocus(events);
    expect(result).toEqual(events);
  });

  it("tolerates malformed nodes without throwing", () => {
    const events = [
      fullSnapshot(null),
      { type: 2, data: {}, timestamp: 1 },
      mutation({ adds: [{ node: null }], attributes: [{ id: 1 }] }),
    ];
    expect(() => stripReplayAutofocus(events)).not.toThrow();
  });
});
