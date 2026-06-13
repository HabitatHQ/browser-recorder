import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  type DebuggerNetworkEvent,
  type NetworkEdit,
  type NetworkField,
  scanNetworkEvents,
} from "@browser-recorder/core";
import { ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fieldKey(f: NetworkField): string {
  return `${f.area}:${f.name ?? ""}`;
}

function fieldLabel(f: NetworkField): string {
  switch (f.area) {
    case "url":
      return "URL";
    case "requestBody":
      return "request body";
    case "responseBody":
      return "response body";
    case "requestHeader":
      return `request header "${f.name}"`;
    case "responseHeader":
      return `response header "${f.name}"`;
  }
}

// ─── Network privacy review ───────────────────────────────────────────────────
// Surfaces likely secrets (opt-in redaction) and lets the submitter drop any
// request entirely. Nothing is changed unless the submitter explicitly checks a
// box, so an intentional/false-positive value is simply left as-is.

export function NetworkPrivacyReview({
  events,
  edits,
  onChange,
}: {
  events: DebuggerNetworkEvent[];
  edits: Record<number, NetworkEdit>;
  onChange: (edits: Record<number, NetworkEdit>) => void;
}) {
  const [open, setOpen] = useState(false);

  const findingsByEvent = useMemo(() => {
    const map = new Map<number, ReturnType<typeof scanNetworkEvents>>();
    for (const finding of scanNetworkEvents(events)) {
      const list = map.get(finding.eventIndex) ?? [];
      list.push(finding);
      map.set(finding.eventIndex, list);
    }
    return map;
  }, [events]);

  if (events.length === 0) return null;

  const flaggedCount = findingsByEvent.size;
  const droppedCount = Object.values(edits).filter((e) => e.drop).length;
  const redactedCount = Object.values(edits).reduce((n, e) => n + (e.redactFields?.length ?? 0), 0);

  const setEdit = (i: number, next: NetworkEdit | undefined) => {
    const copy = { ...edits };
    if (!next || (!next.drop && (next.redactFields?.length ?? 0) === 0)) delete copy[i];
    else copy[i] = next;
    onChange(copy);
  };

  const toggleDrop = (i: number) => {
    const cur = edits[i] ?? {};
    setEdit(i, { ...cur, drop: !cur.drop });
  };

  const toggleField = (i: number, field: NetworkField) => {
    const cur = edits[i] ?? {};
    const fields = cur.redactFields ?? [];
    const key = fieldKey(field);
    const has = fields.some((f) => fieldKey(f) === key);
    setEdit(i, {
      ...cur,
      redactFields: has ? fields.filter((f) => fieldKey(f) !== key) : [...fields, field],
    });
  };

  const redactAllDetected = () => {
    const next: Record<number, NetworkEdit> = { ...edits };
    for (const [i, findings] of findingsByEvent) {
      const cur = next[i] ?? {};
      if (cur.drop) continue;
      next[i] = { ...cur, redactFields: findings.map((f) => f.field) };
    }
    onChange(next);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left text-sm"
        onClick={() => setOpen((v) => !v)}
      >
        <ShieldAlert
          className={cn("h-4 w-4", flaggedCount > 0 ? "text-yellow-600" : "text-muted-foreground")}
        />
        <span className="flex-1 font-medium">Network privacy</span>
        <span className="text-xs text-muted-foreground">
          {events.length} request{events.length !== 1 ? "s" : ""}
          {flaggedCount > 0 ? ` · ${flaggedCount} flagged` : ""}
          {droppedCount > 0 ? ` · ${droppedCount} dropped` : ""}
          {redactedCount > 0 ? ` · ${redactedCount} redacted` : ""}
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          {flaggedCount > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">
                Detected possible secrets. Redaction is opt-in — leave a box unchecked to keep the
                value as-is.
              </span>
              <button
                type="button"
                className="ml-auto shrink-0 text-primary hover:underline"
                onClick={redactAllDetected}
              >
                Redact all detected
              </button>
            </div>
          )}
          <div className="max-h-80 overflow-auto rounded-md bg-muted p-2 flex flex-col gap-1">
            {events.map((ev, i) => {
              const findings = findingsByEvent.get(i);
              const edit = edits[i];
              const dropped = !!edit?.drop;
              const failed = ev.status !== undefined && ev.status >= 400;
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: network events have no stable id
                <div key={i} className="text-xs border-b border-border/50 pb-1 last:border-0">
                  <div className="flex items-center gap-2 font-mono">
                    <label className="flex items-center gap-1 shrink-0 text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-destructive"
                        checked={dropped}
                        onChange={() => toggleDrop(i)}
                      />
                      drop
                    </label>
                    <span
                      className={cn(
                        "shrink-0 rounded px-1",
                        failed ? "bg-destructive/20 text-destructive" : "bg-muted-foreground/15"
                      )}
                    >
                      {ev.status ?? "—"}
                    </span>
                    <span className="shrink-0 text-muted-foreground">{ev.method}</span>
                    <span
                      className={cn(
                        "flex-1 break-all min-w-0",
                        dropped && "line-through opacity-50"
                      )}
                    >
                      {ev.url}
                    </span>
                    {findings && (
                      <Badge variant="secondary" className="shrink-0 text-[10px] px-1 py-0">
                        {findings.length} secret{findings.length !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                  {findings && !dropped && (
                    <div className="mt-1 flex flex-col gap-0.5 pl-6">
                      {findings.map((f) => {
                        const checked =
                          edit?.redactFields?.some((x) => fieldKey(x) === fieldKey(f.field)) ??
                          false;
                        const kinds = [...new Set(f.matches.map((m) => m.kind))].join(", ");
                        return (
                          <label
                            key={fieldKey(f.field)}
                            className="flex items-center gap-2 cursor-pointer text-muted-foreground"
                          >
                            <input
                              type="checkbox"
                              className="accent-primary"
                              checked={checked}
                              onChange={() => toggleField(i, f.field)}
                            />
                            <span>
                              Redact {fieldLabel(f.field)}{" "}
                              <span className="text-muted-foreground/60">({kinds})</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Include-in-export toggles + size estimate ────────────────────────────────

export interface IncludeRow {
  key: string;
  label: string;
  count?: number;
  bytes: number;
  /** Non-toggleable note (e.g. video downloaded separately). */
  note?: string;
  toggleable: boolean;
}

export function IncludeOptions({
  rows,
  value,
  onToggle,
}: {
  rows: IncludeRow[];
  value: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const total = rows.reduce((n, r) => n + (!r.toggleable || value[r.key] ? r.bytes : 0), 0);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Include in export</span>
        <span className="text-xs text-muted-foreground tabular-nums">≈ {formatBytes(total)}</span>
      </div>
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <label
            key={r.key}
            className={cn(
              "flex items-center gap-2 text-sm",
              r.toggleable ? "cursor-pointer" : "opacity-70"
            )}
          >
            <input
              type="checkbox"
              className="accent-primary"
              checked={r.toggleable ? (value[r.key] ?? true) : true}
              disabled={!r.toggleable}
              onChange={() => r.toggleable && onToggle(r.key)}
            />
            <span className="flex-1 text-muted-foreground">
              {r.label}
              {r.count !== undefined ? ` (${r.count})` : ""}
              {r.note ? <span className="text-muted-foreground/60"> — {r.note}</span> : null}
            </span>
            <span className="text-xs text-muted-foreground/70 tabular-nums">
              {formatBytes(r.bytes)}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
