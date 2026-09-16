import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type SessionLifecycleState, transitionSessionLifecycle } from "./session-lifecycle";

const idle = { status: "idle" as const, operationId: 0 };

describe("transitionSessionLifecycle", () => {
  it("does not allow stale readiness to revive a cancelled start", () => {
    const starting = transitionSessionLifecycle(idle, { type: "start", operationId: 1 });
    const cancelled = transitionSessionLifecycle(starting, { type: "cancel", operationId: 1 });

    expect(transitionSessionLifecycle(cancelled, { type: "ready", operationId: 1 })).toEqual(
      cancelled
    );
  });

  it("seals stopped reports against later collection", () => {
    const recording = transitionSessionLifecycle(
      transitionSessionLifecycle(idle, { type: "start", operationId: 1 }),
      { type: "ready", operationId: 1 }
    );
    const draining = transitionSessionLifecycle(recording, { type: "stop", operationId: 1 });
    const review = transitionSessionLifecycle(draining, { type: "drained", operationId: 1 });

    expect(transitionSessionLifecycle(review, { type: "event", operationId: 1 })).toEqual(review);
  });

  it("never returns to recording without a matching ready event", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("pause", "stop", "cancel", "event")), (events) => {
        const state = events.reduce<SessionLifecycleState>(
          (current, type) => transitionSessionLifecycle(current, { type, operationId: 1 }),
          idle
        );
        expect(state.status).not.toBe("recording");
      })
    );
  });
});
