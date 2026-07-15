// Pure domain-scope logic for the always-on ring recorder. No chrome APIs — this
// is the single source of truth for "may this URL be recorded right now?" and is
// exercised directly by unit tests. See docs/plans/always-on-ring-refinement.md.

export type RingScopeMode = "allowlist" | "blocklist" | "all";

export interface RingScopeConfig {
  mode: RingScopeMode;
  // Hostname patterns, one per entry. `*` is a wildcard (any run of characters);
  // everything else is matched literally. e.g. `*.staging.example.com`.
  allow: string[];
  block: string[];
}

export const DEFAULT_RING_SCOPE: RingScopeConfig = {
  mode: "allowlist",
  allow: [],
  block: [],
};

// Why the URL is (not) recordable. The popup turns this into plain-language text
// so an empty capture never looks broken.
export type RingScopeReason =
  | "internal" // browser-internal / extension page — never recorded
  | "blocked" // matches the blocklist — never recorded, even if pinned
  | "pinned" // opted in via a session pin
  | "allowed" // matches the allowlist
  | "blocklist-mode" // blocklist mode, not blocked
  | "all-mode" // record-everything mode
  | "empty-allowlist" // allowlist mode with an empty list — nothing recordable
  | "not-in-allowlist"; // allowlist mode, not listed and not pinned

export interface RingEligibility {
  recordable: boolean;
  reason: RingScopeReason;
}

export function hostFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const INTERNAL_SCHEMES = [
  "chrome:",
  "about:",
  "edge:",
  "chrome-extension:",
  "moz-extension:",
  "chrome-untrusted:",
  "devtools:",
  "view-source:",
];

export function isBrowserInternal(url: string | undefined): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  return INTERNAL_SCHEMES.some((scheme) => lower.startsWith(scheme));
}

// Escape a string for literal use inside a RegExp, leaving `*` for us to turn
// into a wildcard afterward.
function escapeExceptStar(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === "*" ? "\0" : `\\${ch}`));
}

export function hostMatchesPattern(host: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  const regexSource = `^${escapeExceptStar(trimmed).replaceAll("\0", ".*")}$`;
  return new RegExp(regexSource, "i").test(host);
}

export function hostMatchesAny(host: string, patterns: string[]): boolean {
  return patterns.some((p) => hostMatchesPattern(host, p));
}

// Precedence: internal → block → pin → mode. Block always wins.
export function evaluateRingScope(
  url: string | undefined,
  scope: RingScopeConfig,
  pins: string[]
): RingEligibility {
  if (isBrowserInternal(url)) return { recordable: false, reason: "internal" };

  const host = hostFromUrl(url);
  if (host === null) return { recordable: false, reason: "internal" };

  if (hostMatchesAny(host, scope.block)) return { recordable: false, reason: "blocked" };

  // Pins are concrete hostnames captured from a tab — exact-match.
  if (pins.some((pin) => pin.toLowerCase() === host)) {
    return { recordable: true, reason: "pinned" };
  }

  if (scope.mode === "all") return { recordable: true, reason: "all-mode" };
  if (scope.mode === "blocklist") return { recordable: true, reason: "blocklist-mode" };

  // allowlist mode
  if (scope.allow.length === 0) return { recordable: false, reason: "empty-allowlist" };
  if (hostMatchesAny(host, scope.allow)) return { recordable: true, reason: "allowed" };
  return { recordable: false, reason: "not-in-allowlist" };
}
