import type { DebuggerNetworkEvent } from "./types.js";

/** Wrap a string in single quotes, escaping any embedded single quotes for POSIX shells. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Render a captured network entry as a `curl` command. This is a *scaffold*, not a
 * turnkey command: captured entries have sensitive headers (Cookie, Authorization)
 * stripped and long bodies truncated, so the caller may need to fill those back in.
 * See docs/plans/request-replay.md §3.
 */
export function toCurl(ev: DebuggerNetworkEvent): string {
  const method = (ev.method || "GET").toUpperCase();
  const hasBody = typeof ev.requestBody === "string" && ev.requestBody.length > 0;

  const parts: string[] = [`curl ${shQuote(ev.url)}`];
  // curl defaults to GET, and to POST when a body is present; emit -X whenever the
  // method wouldn't otherwise be inferred correctly.
  if (method !== "GET" || hasBody) parts.push(`-X ${method}`);
  if (ev.requestHeaders) {
    for (const [name, value] of Object.entries(ev.requestHeaders)) {
      parts.push(`-H ${shQuote(`${name}: ${value}`)}`);
    }
  }
  if (hasBody) parts.push(`--data-raw ${shQuote(ev.requestBody as string)}`);

  return parts.join(" \\\n  ");
}
