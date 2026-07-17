import { Button } from "@/components/ui/button";
import { sendToBackground } from "@/lib/messaging";
import { cn } from "@/lib/utils";
import {
  type DebuggerNetworkEvent,
  type ReplayResult,
  headersToText,
  parseHeadersText,
  seedReplayInput,
} from "@browser-recorder/core";
import { Loader2, Send } from "lucide-react";
import { useMemo, useState } from "react";

function statusClass(status: number): string {
  return status >= 400
    ? "bg-destructive/20 text-destructive"
    : "bg-emerald-500/15 text-emerald-400";
}

/**
 * Live "edit and resend" for a captured request. Ephemeral by design: nothing
 * here is written back to the session or the export — the response lives only in
 * this component's state, so it never enters the redaction pipeline.
 * See docs/plans/request-replay.md.
 */
export function ReplayPanel({
  event,
  tabId,
}: {
  event: DebuggerNetworkEvent;
  tabId: number;
}) {
  const seed = useMemo(() => seedReplayInput(event), [event]);
  const [method, setMethod] = useState(seed.method);
  const [url, setUrl] = useState(seed.url);
  const [headersText, setHeadersText] = useState(() => headersToText(seed.headers));
  const [body, setBody] = useState(seed.body ?? "");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await sendToBackground<ReplayResult>({
        type: "replay-request",
        tabId,
        input: {
          method,
          url,
          headers: parseHeadersText(headersText),
          body: body.length > 0 ? body : undefined,
        },
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Replay failed");
    } finally {
      setSending(false);
    }
  };

  const statusChanged =
    result?.outcome === "response" && event.status !== undefined && result.status !== event.status;

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-background/60 p-2">
      <div className="flex items-center gap-2">
        <input
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="w-20 shrink-0 rounded border border-input bg-background px-2 py-1 font-mono text-xs uppercase"
          aria-label="method"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 min-w-0 rounded border border-input bg-background px-2 py-1 font-mono text-xs"
          aria-label="url"
        />
        <Button size="sm" onClick={send} disabled={sending || url.trim() === ""}>
          {sending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
          Send
        </Button>
      </div>

      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Headers (one per line — auth/cookies are supplied by the live session)
        <textarea
          value={headersText}
          onChange={(e) => setHeadersText(e.target.value)}
          rows={3}
          spellCheck={false}
          className="rounded border border-input bg-background px-2 py-1 font-mono text-xs text-foreground"
        />
      </label>

      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Body
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          spellCheck={false}
          placeholder="(none)"
          className="rounded border border-input bg-background px-2 py-1 font-mono text-xs text-foreground"
        />
      </label>

      {error && (
        <div className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{error}</div>
      )}

      {result?.outcome === "error" && (
        <div className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {result.error} · {result.durationMs}ms
          <div className="mt-1 text-[10px] text-muted-foreground">
            Cross-origin requests are blocked by the page's CORS policy — same-origin replays work.
          </div>
        </div>
      )}

      {result?.outcome === "response" && (
        <div className="flex flex-col gap-1 text-xs">
          <div className="flex items-center gap-2 font-mono">
            <span className={cn("rounded px-1", statusClass(result.status))}>
              {result.status} {result.statusText}
            </span>
            <span className="text-muted-foreground">{result.durationMs}ms</span>
            {event.status !== undefined && (
              <span
                className={cn(
                  "text-[10px]",
                  statusChanged ? "text-amber-400" : "text-muted-foreground"
                )}
              >
                (was {event.status})
              </span>
            )}
            {result.redirected && (
              <span className="text-[10px] text-muted-foreground break-all">
                → {result.finalUrl}
              </span>
            )}
          </div>
          <details>
            <summary className="cursor-pointer text-muted-foreground">response headers</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">
              {headersToText(result.headers)}
            </pre>
          </details>
          <details open>
            <summary className="cursor-pointer text-muted-foreground">
              response body{result.bodyTruncated ? " (truncated)" : ""}
            </summary>
            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">
              {result.body || "(empty)"}
            </pre>
          </details>
          {event.responseBody && (
            <details>
              <summary className="cursor-pointer text-muted-foreground">
                original response body
              </summary>
              <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/50 p-2">
                {event.responseBody}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
