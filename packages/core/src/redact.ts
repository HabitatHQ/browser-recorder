import type { DebuggerNetworkEvent } from "./types.js";

export type SecretKind = "jwt" | "email" | "bearer" | "secret-kv" | "long-token";

export interface SecretMatch {
  kind: SecretKind;
  /** Start index of the match within the scanned text. */
  index: number;
  /** Matched substring. */
  value: string;
}

export const REDACTED = "[REDACTED]";

// Order matters: more specific / higher-signal patterns first so their kind
// wins when ranges overlap (the range merge keeps the earliest match's label
// only for display; redaction itself is kind-agnostic).
const PATTERNS: Array<{ kind: SecretKind; re: RegExp }> = [
  // JSON-web-token: three base64url segments. Catches most session/access tokens.
  { kind: "jwt", re: /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g },
  // Authorization: Bearer <token>
  { kind: "bearer", re: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi },
  // key=value / "key":"value" where the key names a credential.
  {
    kind: "secret-kv",
    re: /\b(?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?id|auth)\b["']?\s*[:=]\s*["']?([^"'&\s,}]{3,})/gi,
  },
  { kind: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Long opaque hex/base64 blobs that look like keys (kept last; lower signal).
  { kind: "long-token", re: /\b[A-Fa-f0-9]{32,}\b|\b[A-Za-z0-9+/]{40,}={0,2}\b/g },
];

/** Find likely secrets in a string. Matches may overlap; merge before redacting. */
export function scanText(text: string): SecretMatch[] {
  if (!text) return [];
  const out: SecretMatch[] = [];
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null = re.exec(text);
    while (m !== null) {
      out.push({ kind, index: m.index, value: m[0] });
      // Guard against zero-length matches looping forever.
      if (m.index === re.lastIndex) re.lastIndex++;
      m = re.exec(text);
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/** Replace every matched range with [REDACTED], merging overlaps/adjacency. */
export function redactMatches(text: string, matches: SecretMatch[]): string {
  if (matches.length === 0) return text;
  const ranges = matches
    .map((m) => ({ start: m.index, end: m.index + m.value.length }))
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }

  let result = "";
  let cursor = 0;
  for (const { start, end } of merged) {
    result += text.slice(cursor, start) + REDACTED;
    cursor = end;
  }
  result += text.slice(cursor);
  return result;
}

export type NetworkFieldArea = "url" | "requestBody" | "responseBody" | "requestHeader" | "responseHeader";

export interface NetworkField {
  area: NetworkFieldArea;
  /** Header name when area is requestHeader / responseHeader. */
  name?: string;
}

export interface NetworkFinding {
  /** Index into the scanned network-event array. */
  eventIndex: number;
  field: NetworkField;
  matches: SecretMatch[];
}

function scanField(
  eventIndex: number,
  field: NetworkField,
  text: string | undefined,
  out: NetworkFinding[],
): void {
  if (!text) return;
  const matches = scanText(text);
  if (matches.length > 0) out.push({ eventIndex, field, matches });
}

/** Scan every network event's url, bodies and header values for secrets. */
export function scanNetworkEvents(events: DebuggerNetworkEvent[]): NetworkFinding[] {
  const out: NetworkFinding[] = [];
  events.forEach((ev, i) => {
    scanField(i, { area: "url" }, ev.url, out);
    scanField(i, { area: "requestBody" }, ev.requestBody, out);
    scanField(i, { area: "responseBody" }, ev.responseBody, out);
    for (const [name, value] of Object.entries(ev.requestHeaders ?? {})) {
      scanField(i, { area: "requestHeader", name }, value, out);
    }
    for (const [name, value] of Object.entries(ev.responseHeaders ?? {})) {
      scanField(i, { area: "responseHeader", name }, value, out);
    }
  });
  return out;
}
