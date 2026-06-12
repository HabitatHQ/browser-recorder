import { AnnotationCanvas } from "@/components/annotation/AnnotationCanvas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { MicButton } from "@/components/voice-input";
import { sendDebuggerMessage } from "@/lib/bug-report-debugger/messaging";
import { computeExportBaseName, exportReportAsZip } from "@/lib/export";
import { sendToBackground } from "@/lib/messaging";
import { domSnapshotOpfsFilename } from "@/lib/storage";
import {
  type CaptureConfig,
  DEFAULT_CAPTURE_CONFIG,
  type NetworkFilterConfig,
  type RingSnapshot,
  type ScreenshotEntry,
  type Session,
  type SessionCounts,
  type SubmitFormValues,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { GET_SESSION_SNAPSHOT_MESSAGE } from "@/vendor/capture-core/debugger/constants";
import type {
  DebuggerActionEvent,
  DebuggerConsoleEvent,
  DebuggerNetworkEvent,
  DebuggerSSEEvent,
  DebuggerSessionSnapshot,
  DebuggerWebSocketEvent,
} from "@/vendor/capture-core/debugger/types";
import {
  AlertTriangle,
  ArrowLeftRight,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code,
  Download,
  FileCode,
  FolderOpen,
  MousePointer,
  Network,
  Radio,
  RotateCcw,
  Trash2,
  Video,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type AppState = "loading" | "annotating" | "form" | "submitting" | "success";

interface DebuggerEvents {
  console: unknown[];
  network: unknown[];
  interactions: unknown[];
  websocket: unknown[];
  sse: unknown[];
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function SummaryRow({
  icon,
  label,
  count,
  badge,
  items,
  renderItem,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  badge?: React.ReactNode;
  items?: unknown[];
  renderItem?: (item: unknown, index: number) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hasItems = items && items.length > 0;

  return (
    <div>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 py-1.5 text-sm text-left",
          hasItems ? "cursor-pointer hover:text-foreground" : "cursor-default"
        )}
        onClick={() => hasItems && setOpen((v) => !v)}
        disabled={!hasItems}
      >
        {icon}
        <span className="flex-1 text-muted-foreground">{label}</span>
        {badge}
        <span className="font-medium tabular-nums">{count}</span>
        {hasItems ? (
          open ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )
        ) : null}
      </button>
      {open &&
        items &&
        (renderItem ? (
          <div className="mt-1 mb-2 max-h-48 overflow-auto rounded-md bg-muted p-2 flex flex-col gap-0.5">
            {items.map((item, i) => renderItem(item, i))}
          </div>
        ) : (
          <pre className="mt-1 mb-2 max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs text-foreground">
            {JSON.stringify(items.slice(0, 10), null, 2)}
          </pre>
        ))}
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<AppState>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [counts, setCounts] = useState<SessionCounts>({
    console: 0,
    network: 0,
    interactions: 0,
    websocket: 0,
    sse: 0,
    domSnapshots: 0,
    screenshots: 0,
    errors: 0,
  });
  const [screenshots, setScreenshots] = useState<ScreenshotEntry[]>([]);
  const [annotatingIndex, setAnnotatingIndex] = useState<number | null>(null);
  const [domSnapshots, setDomSnapshots] = useState<Record<string, string>>({});
  const [debuggerEvents, setDebuggerEvents] = useState<DebuggerEvents>({
    console: [],
    network: [],
    interactions: [],
    websocket: [],
    sse: [],
  });
  const [formValues, setFormValues] = useState<SubmitFormValues>({
    title: "Bug report",
    description: "",
    notes: "",
  });
  const [exportFilename, setExportFilename] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [videoDownloading, setVideoDownloading] = useState(false);

  const modeRef = useRef<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode");
    modeRef.current = mode;

    async function load() {
      try {
        const [sess, cnts] = await Promise.all([
          sendToBackground<Session | null>({ type: "get-session" }),
          sendToBackground<SessionCounts>({ type: "get-counts" }),
        ]);
        setSession(sess);
        setCounts(cnts);

        if (sess?.tabTitle) {
          setFormValues((v) => ({ ...v, title: sess.tabTitle ?? v.title }));
        }

        if (mode === "screenshot") {
          const ssResult = (await chrome.storage.session.get("screenshotFilenames")) as {
            screenshotFilenames?: string[];
          };
          const filenames = ssResult.screenshotFilenames ?? [];
          const opfsDir = await navigator.storage.getDirectory();
          const entries = await Promise.all(
            filenames.map(async (fn): Promise<ScreenshotEntry | null> => {
              try {
                const handle = await opfsDir.getFileHandle(fn);
                const file = await handle.getFile();
                const dataUrl = await fileToDataUrl(file);
                await opfsDir.removeEntry(fn).catch(() => {});
                return { dataUrl, annotatedBlob: null };
              } catch {
                return null;
              }
            })
          );
          await chrome.storage.session.remove("screenshotFilenames");
          const loaded = entries.filter((e): e is ScreenshotEntry => e !== null);
          setScreenshots(loaded);
          if (loaded.length > 0) {
            setAnnotatingIndex(loaded.length - 1);
            setState("annotating");
          } else {
            setState("form");
          }
          return;
        }

        if (mode === "snapshot") {
          const snapResult = (await chrome.storage.session.get("domSnapshotFilenames")) as {
            domSnapshotFilenames?: string[];
          };
          const filenames = snapResult.domSnapshotFilenames ?? [];
          const opfsDir = await navigator.storage.getDirectory();
          const snaps: Record<string, string> = {};
          let i = 1;
          for (const fn of filenames) {
            try {
              const handle = await opfsDir.getFileHandle(fn);
              const file = await handle.getFile();
              snaps[String(i)] = await file.text();
              await opfsDir.removeEntry(fn).catch(() => {});
              i++;
            } catch {
              // Skip unavailable snapshots
            }
          }
          await chrome.storage.session.remove("domSnapshotFilenames");
          setDomSnapshots(snaps);
          setCounts((c) => ({ ...c, domSnapshots: Object.keys(snaps).length }));
          setState("form");
          return;
        }

        if (mode === "ring") {
          const ringResult = (await chrome.storage.session.get("ringSnapshot")) as {
            ringSnapshot?: RingSnapshot;
          };
          const ring = ringResult.ringSnapshot;
          if (ring) {
            const ringSession: Session = {
              id: ring.id,
              tabId: -1,
              tabUrl: ring.tabUrl,
              tabTitle: ring.tabTitle,
              startedAt: ring.startedAt,
              status: "stopping",
              captureConfig: DEFAULT_CAPTURE_CONFIG,
              debuggerSessionId: null,
              domSnapshotCount: 0,
              domSnapshotKeys: [],
              screenshotFilenames: [],
              videoOpfsFilename: ring.videoOpfsFilename,
            };
            setSession(ringSession);
            setCounts({
              console: ring.console.length,
              network: ring.network.length,
              interactions: ring.interactions.length,
              websocket: 0,
              sse: 0,
              domSnapshots: 0,
              screenshots: 0,
              errors: 0,
            });
            setDebuggerEvents({
              console: ring.console,
              network: ring.network,
              interactions: ring.interactions,
              websocket: [],
              sse: [],
            });
            setFormValues((v) => ({ ...v, title: ring.tabTitle ?? "Browser recording" }));
          }
          setState("form");
          return;
        }

        const dir = await navigator.storage.getDirectory();

        const [loadedScreenshots, loadedSnaps] = await Promise.all([
          Promise.all(
            (sess?.screenshotFilenames ?? []).map(
              async (filename): Promise<ScreenshotEntry | null> => {
                try {
                  const handle = await dir.getFileHandle(filename);
                  const file = await handle.getFile();
                  const dataUrl = await fileToDataUrl(file);
                  return { dataUrl, annotatedBlob: null };
                } catch {
                  return null;
                }
              }
            )
          ),
          (async (): Promise<Record<string, string>> => {
            const snaps: Record<string, string> = {};
            await Promise.all(
              (sess?.domSnapshotKeys ?? []).map(async (key) => {
                try {
                  const filename = domSnapshotOpfsFilename(sess?.id ?? "", key);
                  const handle = await dir.getFileHandle(filename);
                  const file = await handle.getFile();
                  snaps[key] = await file.text();
                } catch {
                  // Skip unavailable snapshots
                }
              })
            );
            return snaps;
          })(),
        ]);

        setScreenshots(loadedScreenshots.filter((e): e is ScreenshotEntry => e !== null));
        setDomSnapshots(loadedSnaps);

        if (sess?.debuggerSessionId) {
          try {
            const snapshot = await sendDebuggerMessage<DebuggerSessionSnapshot | null>({
              type: GET_SESSION_SNAPSHOT_MESSAGE,
              payload: { sessionId: sess.debuggerSessionId },
            });
            if (snapshot?.events) {
              const consoleEvts: unknown[] = [];
              const networkEvts: unknown[] = [];
              const actionEvts: unknown[] = [];
              const wsEvts: unknown[] = [];
              const sseEvts: unknown[] = [];
              for (const ev of snapshot.events) {
                if (ev.kind === "console") consoleEvts.push(ev);
                else if (ev.kind === "network") networkEvts.push(ev);
                else if (ev.kind === "action") actionEvts.push(ev);
                else if (ev.kind === "websocket") wsEvts.push(ev);
                else if (ev.kind === "sse") sseEvts.push(ev);
              }
              setDebuggerEvents({
                console: consoleEvts,
                network: networkEvts,
                interactions: actionEvts,
                websocket: wsEvts,
                sse: sseEvts,
              });
            }
          } catch {
            // debugger snapshot unavailable; continue without it
          }
        }

        setState("form");
      } catch (err) {
        console.error("Recorder load error", err);
        setState("form");
      }
    }

    void load();
  }, []);

  function handleAnnotationDone(blob: Blob) {
    setScreenshots((prev) =>
      prev.map((entry, i) => (i === annotatingIndex ? { ...entry, annotatedBlob: blob } : entry))
    );
    setAnnotatingIndex(null);
    setState("form");
  }

  function openAnnotation(index: number) {
    setAnnotatingIndex(index);
    setState("annotating");
  }

  function handleDeleteScreenshot(index: number) {
    setScreenshots((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("submitting");
    setExportError(null);
    try {
      const { captureConfig: exportConfig } = await sendToBackground<{
        captureConfig: CaptureConfig;
        networkFilter: NetworkFilterConfig;
      }>({ type: "get-settings" });
      const filename = await exportReportAsZip({
        session,
        counts,
        formValues,
        screenshots,
        domSnapshots,
        debuggerEvents,
        nestInFolder: exportConfig.zipFolderNesting,
        zipTitleFilename: exportConfig.zipTitleFilename,
      });
      setExportFilename(filename);
      if (modeRef.current === "ring") {
        if (session?.videoOpfsFilename) {
          const dir = await navigator.storage.getDirectory();
          await dir.removeEntry(session.videoOpfsFilename).catch(() => {});
        }
        await chrome.storage.session.remove("ringSnapshot");
      }
      setState("success");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err));
      setState("form");
    }
  }

  async function handleVideoDownload() {
    const filename = session?.videoOpfsFilename;
    if (!filename) return;
    setVideoDownloading(true);
    try {
      const { captureConfig: dlConfig } = await sendToBackground<{
        captureConfig: CaptureConfig;
        networkFilter: NetworkFilterConfig;
      }>({ type: "get-settings" });
      const ext = filename.endsWith(".mp4") ? ".mp4" : ".webm";
      const baseName = computeExportBaseName(
        formValues,
        session,
        dlConfig.zipTitleFilename,
        new Date()
      );
      const dir = await navigator.storage.getDirectory();
      const fileHandle = await dir.getFileHandle(filename);
      const file = await fileHandle.getFile();
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      // File not yet available — user can retry
    } finally {
      setVideoDownloading(false);
    }
  }

  function handleReset() {
    setScreenshots((prev) => prev.map((s) => ({ ...s, annotatedBlob: null })));
    setExportFilename(null);
    setExportError(null);
    setState("form");
  }

  if (state === "loading") {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    );
  }

  if (state === "annotating" && annotatingIndex !== null) {
    const entry = screenshots[annotatingIndex];
    if (entry) {
      return (
        <AnnotationCanvas
          imageDataUrl={entry.dataUrl}
          onDone={handleAnnotationDone}
          onCancel={() => {
            setAnnotatingIndex(null);
            setState("form");
          }}
        />
      );
    }
  }

  if (state === "success") {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <CheckCircle2 className="h-12 w-12 text-green-500 dark:text-green-400" />
          <div>
            <p className="font-semibold text-lg">Report exported</p>
            {exportFilename && <p className="text-sm font-medium mt-1">{exportFilename}</p>}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() =>
                chrome.tabs.create({
                  url:
                    import.meta.env.BROWSER === "firefox"
                      ? "about:downloads"
                      : "chrome://downloads",
                })
              }
            >
              <FolderOpen className="h-4 w-4" />
              Open Downloads
            </Button>
            <Button variant="ghost" onClick={handleReset}>
              <RotateCcw className="h-4 w-4" />
              New report
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const isSubmitting = state === "submitting";
  const domSnapshotKeys = Object.keys(domSnapshots);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-xl font-semibold mb-6">Review &amp; export bug report</h1>

        <form onSubmit={handleSubmit}>
          <div className="grid gap-6 md:grid-cols-2">
            {/* Left: captured data summary */}
            <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-1">
              <p className="text-sm font-medium mb-2">Captured data</p>

              <SummaryRow
                icon={<Code className="h-4 w-4 text-muted-foreground" />}
                label="Console"
                count={counts.console}
                badge={
                  counts.errors > 0 ? (
                    <Badge variant="destructive" className="text-xs px-1.5 py-0">
                      {counts.errors} errors
                    </Badge>
                  ) : undefined
                }
                items={debuggerEvents.console}
                renderItem={(item, i) => {
                  const ev = item as DebuggerConsoleEvent;
                  const relSec = session
                    ? ((ev.timestamp - session.startedAt) / 1000).toFixed(1)
                    : null;
                  return (
                    <div key={i} className="flex items-start gap-2 py-0.5 text-xs">
                      <span
                        className={cn(
                          "shrink-0 rounded px-1 font-mono uppercase text-[10px] leading-5",
                          ev.level === "error"
                            ? "bg-destructive/20 text-destructive"
                            : ev.level === "warn"
                              ? "bg-yellow-500/20 text-yellow-700"
                              : "bg-muted-foreground/15 text-muted-foreground"
                        )}
                      >
                        {ev.level}
                      </span>
                      <span className="flex-1 break-all text-foreground min-w-0">{ev.message}</span>
                      <span className="shrink-0 text-muted-foreground/60 text-right tabular-nums text-[10px]">
                        {relSec ? `+${relSec}s` : ""}
                        {ev.timestamp ? ` (${new Date(ev.timestamp).toLocaleTimeString()})` : ""}
                      </span>
                    </div>
                  );
                }}
              />
              <Separator />
              <SummaryRow
                icon={<Network className="h-4 w-4 text-muted-foreground" />}
                label="Network"
                count={counts.network}
                items={debuggerEvents.network}
                renderItem={(item, i) => {
                  const ev = item as DebuggerNetworkEvent;
                  const relSec = session
                    ? ((ev.timestamp - session.startedAt) / 1000).toFixed(1)
                    : null;
                  return (
                    <div
                      key={i}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-0.5 text-xs font-mono"
                    >
                      <span
                        className={cn(
                          "shrink-0 rounded px-1 text-[10px] leading-5",
                          ev.status !== undefined && ev.status >= 400
                            ? "bg-destructive/20 text-destructive"
                            : "bg-muted-foreground/15 text-muted-foreground"
                        )}
                      >
                        {ev.status ?? "—"}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{ev.method}</span>
                      <span className="flex-1 break-all text-foreground min-w-0">{ev.url}</span>
                      <span className="shrink-0 text-muted-foreground/60 text-right tabular-nums">
                        {relSec ? `+${relSec}s` : ""}
                        {ev.timestamp ? ` (${new Date(ev.timestamp).toLocaleTimeString()})` : ""}
                      </span>
                    </div>
                  );
                }}
              />
              <Separator />
              <SummaryRow
                icon={<ArrowLeftRight className="h-4 w-4 text-muted-foreground" />}
                label="WebSocket"
                count={counts.websocket}
                items={debuggerEvents.websocket}
                renderItem={(item, i) => {
                  const ev = item as DebuggerWebSocketEvent;
                  const relSec = session
                    ? ((ev.timestamp - session.startedAt) / 1000).toFixed(1)
                    : null;
                  return (
                    <div
                      key={i}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-0.5 text-xs font-mono"
                    >
                      <span
                        className={cn(
                          "shrink-0 rounded px-1 text-[10px] leading-5",
                          ev.event === "send"
                            ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                            : ev.event === "message"
                              ? "bg-green-500/15 text-green-700 dark:text-green-400"
                              : ev.event === "error"
                                ? "bg-destructive/20 text-destructive"
                                : "bg-muted-foreground/15 text-muted-foreground"
                        )}
                      >
                        {ev.event === "send" ? "↑" : ev.event === "message" ? "↓" : ev.event}
                      </span>
                      <span className="flex-1 break-all text-foreground min-w-0">
                        {ev.data ?? ev.url}
                      </span>
                      <span className="shrink-0 text-muted-foreground/60 text-right tabular-nums">
                        {relSec ? `+${relSec}s` : ""}
                        {ev.timestamp ? ` (${new Date(ev.timestamp).toLocaleTimeString()})` : ""}
                      </span>
                    </div>
                  );
                }}
              />
              <Separator />
              <SummaryRow
                icon={<Radio className="h-4 w-4 text-muted-foreground" />}
                label="SSE"
                count={counts.sse}
                items={debuggerEvents.sse}
                renderItem={(item, i) => {
                  const ev = item as DebuggerSSEEvent;
                  const relSec = session
                    ? ((ev.timestamp - session.startedAt) / 1000).toFixed(1)
                    : null;
                  return (
                    <div
                      key={i}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-0.5 text-xs font-mono"
                    >
                      <span className="shrink-0 rounded px-1 text-[10px] leading-5 bg-purple-500/15 text-purple-700 dark:text-purple-400">
                        {ev.eventType ?? ev.event}
                      </span>
                      <span className="flex-1 break-all text-foreground min-w-0">
                        {ev.data ?? ev.url}
                      </span>
                      <span className="shrink-0 text-muted-foreground/60 text-right tabular-nums">
                        {relSec ? `+${relSec}s` : ""}
                        {ev.timestamp ? ` (${new Date(ev.timestamp).toLocaleTimeString()})` : ""}
                      </span>
                    </div>
                  );
                }}
              />
              <Separator />
              <SummaryRow
                icon={<MousePointer className="h-4 w-4 text-muted-foreground" />}
                label="Interactions"
                count={counts.interactions}
                items={debuggerEvents.interactions}
                renderItem={(item, i) => {
                  const ev = item as DebuggerActionEvent;
                  const relSec = session
                    ? ((ev.timestamp - session.startedAt) / 1000).toFixed(1)
                    : null;
                  const meta = ev.metadata ?? {};
                  return (
                    <div key={i} className="flex flex-col gap-0 py-0.5 text-xs">
                      <div className="flex items-center gap-2 font-mono">
                        <span className="w-20 shrink-0 rounded bg-muted-foreground/15 px-1 text-center">
                          {ev.actionType}
                        </span>
                        <span className="flex-1 truncate text-muted-foreground">
                          {ev.actionType === "navigation"
                            ? String(meta.path ?? meta.url ?? "")
                            : (ev.target ?? "—")}
                        </span>
                        {ev.actionType === "input" && meta.valueLength != null && (
                          <span className="text-muted-foreground shrink-0">
                            {String(meta.valueLength)} chars
                          </span>
                        )}
                        {ev.actionType === "navigation" && !!meta.mode && (
                          <span className="text-muted-foreground shrink-0">
                            {String(meta.mode)}
                          </span>
                        )}
                        <span className="text-muted-foreground/60 shrink-0 text-right tabular-nums">
                          {relSec ? `+${relSec}s` : ""}
                          {ev.timestamp ? ` (${new Date(ev.timestamp).toLocaleTimeString()})` : ""}
                        </span>
                      </div>
                      {!!(meta.label ?? meta.text ?? meta.inputType ?? meta.href) && (
                        <div className="pl-[88px] text-muted-foreground/70 truncate">
                          {[
                            meta.label && `"${String(meta.label)}"`,
                            !meta.label && meta.text && `"${String(meta.text)}"`,
                            meta.inputType && `type=${String(meta.inputType)}`,
                            meta.href && String(meta.href),
                          ]
                            .filter(Boolean)
                            .join("  ")}
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Separator />
              <SummaryRow
                icon={<FileCode className="h-4 w-4 text-muted-foreground" />}
                label="DOM snapshots (HTML)"
                count={counts.domSnapshots}
                items={domSnapshotKeys.length > 0 ? domSnapshotKeys : undefined}
                renderItem={(item, i) => (
                  <div key={i} className="py-0.5 text-xs font-mono text-muted-foreground">
                    dom-snapshot-{String(item)}.html
                  </div>
                )}
              />

              {screenshots.length > 0 && (
                <>
                  <Separator />
                  <div className="py-1">
                    <div className="flex items-center gap-2 text-sm">
                      <Camera className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 text-muted-foreground">Screenshots</span>
                      <span className="font-medium tabular-nums">{screenshots.length}</span>
                    </div>
                    <div className="mt-1.5 flex flex-col gap-1.5 pl-6">
                      {screenshots.map((entry, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: screenshots have no stable ID
                        <div key={i} className="flex items-center gap-2">
                          <img
                            src={entry.dataUrl}
                            alt={`Screenshot ${i + 1}`}
                            className="h-10 w-auto shrink-0 rounded border border-border object-contain"
                          />
                          <span className="flex-1 text-xs text-muted-foreground">#{i + 1}</span>
                          {entry.annotatedBlob && (
                            <Badge variant="secondary" className="text-[10px] px-1 py-0">
                              annotated
                            </Badge>
                          )}
                          <button
                            type="button"
                            className="text-xs text-primary hover:underline"
                            onClick={() => openAnnotation(i)}
                          >
                            Annotate
                          </button>
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-destructive transition-colors"
                            onClick={() => handleDeleteScreenshot(i)}
                            aria-label={`Delete screenshot ${i + 1}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {session?.videoOpfsFilename && (
                <>
                  <Separator />
                  <div className="flex items-center gap-2 py-1.5 text-sm">
                    <Video className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 text-muted-foreground">Recording</span>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline disabled:opacity-50"
                      disabled={videoDownloading}
                      onClick={handleVideoDownload}
                    >
                      {videoDownloading ? "Downloading…" : "Download"}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Right: report form */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={formValues.title}
                  onChange={(e) => setFormValues((v) => ({ ...v, title: e.target.value }))}
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="description">Description</Label>
                  <MicButton
                    value={formValues.description}
                    onChange={(v) => setFormValues((fv) => ({ ...fv, description: v }))}
                  />
                </div>
                <Textarea
                  id="description"
                  rows={3}
                  placeholder="What broke? When does it happen?"
                  value={formValues.description}
                  onChange={(e) => setFormValues((v) => ({ ...v, description: e.target.value }))}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="notes">
                    Notes
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      steps, hypotheses
                    </span>
                  </Label>
                  <MicButton
                    value={formValues.notes}
                    onChange={(v) => setFormValues((fv) => ({ ...fv, notes: v }))}
                  />
                </div>
                <Textarea
                  id="notes"
                  rows={3}
                  placeholder="1. Go to…&#10;2. Click…&#10;3. See error"
                  value={formValues.notes}
                  onChange={(e) => setFormValues((v) => ({ ...v, notes: e.target.value }))}
                />
              </div>

              {exportError && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  {exportError}
                </div>
              )}

              <Button type="submit" disabled={isSubmitting} className="w-full">
                <Download className="h-4 w-4" />
                {isSubmitting ? "Exporting…" : "Export ZIP"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
