import { Badge } from "@/components/ui/badge";
import { type Diagnostics, summarizeDiagnostics } from "@/lib/diagnostics";
import type { CaptureConfig, SessionCounts } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { useState } from "react";

// Permanent capture-health panel. Renders the per-feature pipeline state the
// background records plus expected-vs-actual findings, so a capture that
// produced nothing is explained rather than silently missing.
export function DiagnosticsPanel({
  captureConfig,
  counts,
  diagnostics,
}: {
  captureConfig: CaptureConfig | null;
  counts: SessionCounts;
  diagnostics: Diagnostics | null;
}) {
  const findings = summarizeDiagnostics(captureConfig, counts, diagnostics);
  const errorCount = findings.filter((f) => f.level === "error").length;
  const warnCount = findings.filter((f) => f.level === "warn").length;
  const hasIssues = errorCount + warnCount > 0;
  // Always collapsed by default — the header chips already signal status at a glance.
  const [open, setOpen] = useState(false);

  // Nothing was recorded (e.g. standalone screenshot/snapshot) — hide entirely.
  if (!diagnostics && findings.length === 0) return null;

  const featureEntries = Object.entries(diagnostics?.features ?? {});

  return (
    <div
      className={cn(
        "mb-6 rounded-lg border",
        errorCount > 0
          ? "border-destructive/40 bg-destructive/5"
          : warnCount > 0
            ? "border-yellow-500/40 bg-yellow-500/5"
            : "border-border bg-card"
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm"
        onClick={() => setOpen((v) => !v)}
      >
        {errorCount > 0 ? (
          <XCircle className="h-4 w-4 text-destructive" />
        ) : warnCount > 0 ? (
          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
        )}
        <span className="flex-1 text-left font-medium">Capture diagnostics</span>
        {errorCount > 0 && (
          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
            {errorCount} error{errorCount > 1 ? "s" : ""}
          </Badge>
        )}
        {warnCount > 0 && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {warnCount} warning{warnCount > 1 ? "s" : ""}
          </Badge>
        )}
        {!hasIssues && <span className="text-xs text-muted-foreground">all captures healthy</span>}
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-border/60 px-4 py-3 flex flex-col gap-3 text-xs">
          {findings.length > 0 && (
            <ul className="flex flex-col gap-1">
              {findings.map((f, i) => (
                <li key={`${f.feature}-${i}`} className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-0.5 shrink-0",
                      f.level === "error"
                        ? "text-destructive"
                        : f.level === "warn"
                          ? "text-yellow-600 dark:text-yellow-500"
                          : "text-green-600 dark:text-green-500"
                    )}
                  >
                    {f.level === "error" ? "✗" : f.level === "warn" ? "▲" : "✓"}
                  </span>
                  <span>
                    <span className="font-mono font-medium">{f.feature}</span>{" "}
                    <span className="text-muted-foreground">{f.message}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {featureEntries.length > 0 && (
            <div className="rounded-md bg-muted/50 p-2 font-mono">
              {featureEntries.map(([feature, stages]) => (
                <div
                  key={feature}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-0.5"
                >
                  <span className="w-20 shrink-0 font-medium">{feature}</span>
                  {Object.entries(stages).map(([stage, h]) => (
                    <span key={stage} className="text-muted-foreground">
                      {stage}:
                      <span
                        className={cn(
                          "ml-0.5",
                          h.ok === false
                            ? "text-destructive"
                            : h.ok === true
                              ? "text-foreground"
                              : "text-muted-foreground/60"
                        )}
                      >
                        {h.ok === false ? "fail" : h.ok === true ? `ok·${h.count}` : "pending"}
                      </span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}

          {diagnostics && diagnostics.errors.length > 0 && (
            <details>
              <summary className="cursor-pointer text-muted-foreground">
                {diagnostics.errors.length} recorded error(s)
              </summary>
              <div className="mt-1 max-h-40 overflow-auto rounded-md bg-muted/50 p-2 flex flex-col gap-1 font-mono">
                {diagnostics.errors.map((e, i) => (
                  <div key={`${e.context}-${i}`} className="break-all">
                    <span className="text-foreground">{e.context}</span>:{" "}
                    <span className="text-muted-foreground">{e.message}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
