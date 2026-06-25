import type { Diagnostics } from "@/lib/diagnostics";
import type { ExtensionError } from "@/lib/error-log";
import type { CaptureConfig, NetworkFilterConfig } from "@/lib/types";

// Builders for the "Report a bug" flow. Pure and side-effect-free so they can be
// unit-tested: the options page gathers the data, these turn it into a prefilled
// GitHub issue URL (compact, under GitHub's URL cap) and a full diagnostics blob
// for the clipboard. Settings are reduced to a redacted summary — raw exclusion
// patterns and custom header names (which can contain URLs / secrets) never leave
// the machine.

const ISSUE_TEMPLATE = "bug_report.yml";
// GitHub rejects issue URLs past ~8 KB; stay safely under after percent-encoding.
const MAX_URL_LEN = 7000;

export interface ReportEnvironment {
  version: string;
  browser: string;
  userAgent: string;
  platform: string;
}

export interface SettingsSummary {
  /** Enabled capture toggles, by key. */
  captures: string[];
  networkMode: string;
  exclusionPatternCount: number;
  customRedactedHeaderCount: number;
}

export interface ReportData {
  env: ReportEnvironment;
  settings: SettingsSummary;
  diagnostics: Diagnostics | null;
  errorLog: ExtensionError[];
}

export function summarizeSettings(cc: CaptureConfig, nf: NetworkFilterConfig): SettingsSummary {
  const captures = (Object.keys(cc) as (keyof CaptureConfig)[])
    .filter((k) => cc[k] === true)
    .map(String);
  return {
    captures,
    networkMode: nf.mode,
    exclusionPatternCount: nf.exclusionPatterns.length,
    customRedactedHeaderCount: nf.customRedactedHeaders.length,
  };
}

/** Feature stages currently marked failed, as "feature.stage: error" lines. */
export function failedStages(diag: Diagnostics | null): string[] {
  if (!diag) return [];
  const out: string[] = [];
  for (const [feature, stages] of Object.entries(diag.features)) {
    for (const [stage, health] of Object.entries(stages)) {
      if (health.ok === false) out.push(`${feature}.${stage}: ${health.lastError ?? "failed"}`);
    }
  }
  return out;
}

/** Compact, human-readable context for the issue form's prefilled field. */
export function buildEnvironmentBlock(data: ReportData): string {
  const { env, settings, errorLog, diagnostics } = data;
  const lines: string[] = [
    `Extension version: ${env.version}`,
    `Browser: ${env.browser}`,
    `Platform: ${env.platform}`,
    `User agent: ${env.userAgent}`,
    `Captures enabled: ${settings.captures.join(", ") || "none"}`,
    `Network mode: ${settings.networkMode} (exclusions: ${settings.exclusionPatternCount}, custom redacted headers: ${settings.customRedactedHeaderCount})`,
  ];
  const failed = failedStages(diagnostics);
  if (failed.length) {
    lines.push("Failed stages:");
    for (const f of failed.slice(0, 10)) lines.push(`  - ${f}`);
  }
  lines.push(`Recent internal errors: ${errorLog.length}`);
  if (errorLog.length) {
    const last = errorLog[errorLog.length - 1];
    lines.push(`Last error: [${last.context}] ${last.message}`);
  }
  return lines.join("\n");
}

/**
 * Prefilled GitHub issue-form URL, truncating the env block if it would overflow.
 * `homepageUrl` is the repo URL (from manifest.homepage_url, ultimately
 * package.json) — e.g. "https://github.com/owner/repo".
 */
export function buildIssueUrl(homepageUrl: string, environmentBlock: string): string {
  const base = `${homepageUrl.replace(/\/+$/, "")}/issues/new`;
  const make = (e: string) =>
    `${base}?template=${ISSUE_TEMPLATE}&environment=${encodeURIComponent(e)}`;
  let env = environmentBlock;
  let url = make(env);
  for (let i = 0; i < 16 && url.length > MAX_URL_LEN && env.length > 40; i++) {
    env = `${env.slice(0, Math.floor(env.length * 0.75)).trimEnd()}\n…(truncated — use "Copy full diagnostics")`;
    url = make(env);
  }
  return url;
}

/** Full report for the clipboard (settings already reduced to the redacted summary). */
export function buildFullDiagnostics(data: ReportData): string {
  return JSON.stringify(
    {
      environment: data.env,
      settings: data.settings,
      diagnostics: data.diagnostics,
      errors: data.errorLog,
    },
    null,
    2
  );
}
