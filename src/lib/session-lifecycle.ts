export type SessionLifecycleState =
  | { status: "idle"; operationId: number }
  | { status: "starting"; operationId: number }
  | { status: "recording"; operationId: number }
  | { status: "paused"; operationId: number }
  | { status: "draining"; operationId: number }
  | { status: "review"; operationId: number }
  | { status: "cancelled"; operationId: number };

export type SessionLifecycleEvent =
  | { type: "start"; operationId: number }
  | { type: "ready"; operationId: number }
  | { type: "pause"; operationId: number }
  | { type: "resume"; operationId: number }
  | { type: "stop"; operationId: number }
  | { type: "drained"; operationId: number }
  | { type: "cancel"; operationId: number }
  | { type: "event"; operationId: number };

export const transitionSessionLifecycle = (
  state: SessionLifecycleState,
  event: SessionLifecycleEvent
): SessionLifecycleState => {
  if (event.type === "start" && state.status === "idle" && event.operationId > state.operationId) {
    return { status: "starting", operationId: event.operationId };
  }
  if (event.operationId !== state.operationId) {
    return state;
  }
  if (event.type === "ready" && state.status === "starting") {
    return { status: "recording", operationId: state.operationId };
  }
  if (event.type === "pause" && state.status === "recording") {
    return { status: "paused", operationId: state.operationId };
  }
  if (event.type === "resume" && state.status === "paused") {
    return { status: "starting", operationId: state.operationId };
  }
  if (event.type === "stop" && (state.status === "recording" || state.status === "paused")) {
    return { status: "draining", operationId: state.operationId };
  }
  if (event.type === "drained" && state.status === "draining") {
    return { status: "review", operationId: state.operationId };
  }
  if (event.type === "cancel" && state.status === "starting") {
    return { status: "cancelled", operationId: state.operationId };
  }
  return state;
};
