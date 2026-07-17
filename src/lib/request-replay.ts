import type { ReplayRequestInput, ReplayResult } from "@browser-recorder/core";

/** Response bodies larger than this are truncated before crossing back to the UI. */
const MAX_REPLAY_BODY = 100_000;

/**
 * Replay an HTTP request from the page's own context. Injected verbatim into the
 * MAIN world via chrome.scripting.executeScript, so it MUST stay self-contained:
 * no imports at runtime (the type imports above are erased), no references to
 * module-scoped bindings other than its own locals.
 *
 * Runs with credentials:"include" so the live cookie jar authenticates the
 * request — we deliberately do not reconstruct auth from the (redacted) capture.
 * Cross-origin targets are subject to the page's CORS policy; a blocked request
 * surfaces as an { outcome: "error" } result rather than throwing.
 */
export async function replayInPage(input: ReplayRequestInput): Promise<ReplayResult> {
  const MAX = 100_000;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  try {
    const method = (input.method || "GET").toUpperCase();
    const sendsBody =
      typeof input.body === "string" &&
      input.body.length > 0 &&
      method !== "GET" &&
      method !== "HEAD";
    const res = await fetch(input.url, {
      method,
      headers: input.headers,
      body: sendsBody ? input.body : undefined,
      credentials: "include",
      redirect: "follow",
    });
    const raw = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((value, name) => {
      headers[name] = value;
    });
    return {
      outcome: "response",
      status: res.status,
      statusText: res.statusText,
      headers,
      body: raw.length > MAX ? raw.slice(0, MAX) : raw,
      bodyTruncated: raw.length > MAX,
      durationMs: elapsed(),
      redirected: res.redirected,
      finalUrl: res.url,
    };
  } catch (err) {
    return {
      outcome: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: elapsed(),
    };
  }
}

export { MAX_REPLAY_BODY };
