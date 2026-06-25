import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { formatDuration, useElapsedMs, useSession } from "@/hooks/use-session";
import { sendToBackground } from "@/lib/messaging";
import { canOpenSidePanel, openSidePanel, useDismiss, useSurface } from "@/lib/surface";
import { type CaptureConfig, DEFAULT_CAPTURE_CONFIG, type RingStatus } from "@/lib/types";
import {
  AlertTriangle,
  Camera,
  Circle,
  Code,
  FileCode,
  Loader2,
  MousePointer,
  Network,
  PanelRight,
  RefreshCw,
  Settings,
  Square,
  Video,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

const CONFIRM_FLASH_MS = 1500;
const RING_POLL_MS = 5000;

function formatBufferedTime(oldestMs: number | null): string {
  if (oldestMs === null) return "0s";
  const sec = Math.round((Date.now() - oldestMs) / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function RingSection() {
  const [status, setStatus] = useState<RingStatus | null>(null);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<RingStatus | null>(null);
  const dismiss = useDismiss();

  const fetchStatus = () => {
    sendToBackground<RingStatus>({ type: "get-ring-status" })
      .then((s) => {
        statusRef.current = s;
        setStatus(s);
      })
      .catch(() => {});
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only poll; fetchStatus only calls stable setters/sendToBackground, and re-running would tear down and recreate the interval each render.
  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, RING_POLL_MS);
    return () => clearInterval(id);
  }, []);

  const toggle = async () => {
    if (toggling) return;
    setToggling(true);
    setError(null);
    try {
      const next = !(statusRef.current?.active ?? false);
      const result = await sendToBackground<RingStatus>({ type: "toggle-ring", enabled: next });
      statusRef.current = result;
      setStatus(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setToggling(false);
    }
  };

  const exportRing = async () => {
    try {
      await sendToBackground({ type: "export-ring" });
      dismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const active = status?.active ?? false;
  const hasEvents =
    (status?.eventCounts.console ?? 0) +
      (status?.eventCounts.network ?? 0) +
      (status?.eventCounts.interactions ?? 0) >
    0;

  return (
    <div className="flex flex-col gap-2">
      <Separator />
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Continuous capture
      </p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <RefreshCw className="h-4 w-4 text-muted-foreground" />
          Always on
        </div>
        <Switch id="ring-toggle" checked={active} onChange={toggle} disabled={toggling} />
      </div>
      <p className="text-xs text-muted-foreground pl-6">
        Buffers events in the background — export recent activity without starting a session.
      </p>

      {active && status && (
        <div className="text-xs text-muted-foreground pl-6">
          {hasEvents ? (
            <>
              {formatBufferedTime(status.oldestEventMs)} buffered · {status.eventCounts.console}{" "}
              console · {status.eventCounts.network} network
              {status.eventCounts.interactions > 0
                ? ` · ${status.eventCounts.interactions} int`
                : ""}
              {status.hasVideo ? " · video" : ""}
            </>
          ) : (
            "Buffering…"
          )}
        </div>
      )}

      {active && (
        <Button variant="outline" className="w-full" onClick={exportRing} disabled={!hasEvents}>
          Export
        </Button>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function IdleView({ initialConfig }: { initialConfig: CaptureConfig }) {
  const [config, setConfig] = useState<CaptureConfig>(initialConfig);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismiss = useDismiss();

  const toggle = (key: keyof CaptureConfig) => setConfig((c) => ({ ...c, [key]: !c[key] }));

  const startSession = async () => {
    setStarting(true);
    setError(null);
    try {
      await sendToBackground({ type: "start-session", captureConfig: config });
      dismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  };

  const takeScreenshot = async () => {
    try {
      await sendToBackground({ type: "take-screenshot" });
      dismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const snapshotDom = async () => {
    try {
      await sendToBackground({ type: "snapshot-dom" });
      dismiss();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <Button className="w-full" onClick={startSession} disabled={starting}>
        <Circle className="h-3 w-3 fill-current" />
        {starting ? "Starting…" : "Start session"}
      </Button>
      <p className="text-center text-[10px] text-muted-foreground/60 -mt-2">⌥⇧R</p>

      <Separator />

      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        For this session
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Code className="h-4 w-4 text-muted-foreground" />
            Console
          </div>
          <Switch id="console" checked={config.console} onChange={() => toggle("console")} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Network className="h-4 w-4 text-muted-foreground" />
            Network
          </div>
          <Switch id="network" checked={config.network} onChange={() => toggle("network")} />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <MousePointer className="h-4 w-4 text-muted-foreground" />
            Interactions
          </div>
          <Switch
            id="interactions"
            checked={config.interactions}
            onChange={() => toggle("interactions")}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <FileCode className="h-4 w-4 text-muted-foreground" />
            DOM snapshots
          </div>
          <Switch
            id="domSnapshots"
            checked={config.domSnapshots}
            onChange={() => toggle("domSnapshots")}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Video className="h-4 w-4 text-muted-foreground" />
            Video recording
          </div>
          <Switch id="video" checked={config.video} onChange={() => toggle("video")} />
        </div>
        {import.meta.env.BROWSER === "firefox" && config.video && (
          <p className="text-xs text-muted-foreground pl-6">
            A capture tab will open — select this tab in the picker.
          </p>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-1">
        <Button variant="outline" className="w-full" onClick={takeScreenshot}>
          <Camera className="h-4 w-4" />
          Screenshot
        </Button>
        <p className="text-center text-[10px] text-muted-foreground/60">
          No debug data — annotation only · ⌥⇧C
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <Button variant="outline" className="w-full" onClick={snapshotDom}>
          <FileCode className="h-4 w-4" />
          Snapshot DOM
        </Button>
        <p className="text-center text-[10px] text-muted-foreground/60">
          Capture page HTML — no session · ⌥⇧D
        </p>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <RingSection />
    </div>
  );
}

function ActiveView({ currentTabId }: { currentTabId: number | null }) {
  const { session, counts, loading } = useSession();
  const elapsed = useElapsedMs(session?.startedAt ?? null);
  const [snapshotConfirm, setSnapshotConfirm] = useState(false);
  const [screenshotConfirm, setScreenshotConfirm] = useState(false);
  const [discardPending, setDiscardPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ringActive, setRingActive] = useState(false);
  const dismiss = useDismiss();

  useEffect(() => {
    sendToBackground<RingStatus>({ type: "get-ring-status" })
      .then((s) => setRingActive(s.active))
      .catch(() => {});
  }, []);

  const wrap = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const stopSession = () =>
    wrap(async () => {
      await sendToBackground({ type: "stop-session" });
      dismiss();
    });

  const takeScreenshot = () =>
    wrap(async () => {
      await sendToBackground({ type: "take-screenshot" });
      setScreenshotConfirm(true);
      setTimeout(() => setScreenshotConfirm(false), CONFIRM_FLASH_MS);
    });

  const snapshotDom = () =>
    wrap(async () => {
      await sendToBackground({ type: "snapshot-dom" });
      setSnapshotConfirm(true);
      setTimeout(() => setSnapshotConfirm(false), CONFIRM_FLASH_MS);
    });

  const confirmDiscard = () =>
    wrap(async () => {
      await sendToBackground({ type: "discard-session" });
      dismiss();
    });

  if (loading || !session) return null;

  const isStarting = session.status === "starting";
  const isStopping = session.status === "stopping";
  const isDifferentTab = currentTabId != null && session.tabId !== currentTabId;

  if (isStarting) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Connecting…
      </div>
    );
  }

  const statusParts = [
    `${counts.console} console`,
    `${counts.network} network`,
    counts.websocket > 0 ? `${counts.websocket} ws` : null,
    counts.sse > 0 ? `${counts.sse} sse` : null,
    counts.interactions > 0 ? `${counts.interactions} int` : null,
    counts.domSnapshots > 0 ? `${counts.domSnapshots} dom` : null,
    counts.screenshots > 0 ? `${counts.screenshots} ss` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3 p-4">
      {isDifferentTab && (
        <div className="flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            Recording{" "}
            <span className="font-medium">
              {session.tabTitle ?? session.tabUrl ?? "another tab"}
            </span>
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <Circle className="h-2.5 w-2.5 fill-destructive text-destructive shrink-0" />
        <span className="font-medium">{isStopping ? "Stopping…" : "Recording"}</span>
        <span className="text-muted-foreground">{formatDuration(elapsed)}</span>
        <span className="text-border">│</span>
        <span className="text-muted-foreground">{statusParts.join(" · ")}</span>
        {counts.errors > 0 && <span className="text-destructive">· {counts.errors} errors</span>}
      </div>

      {isStopping && (
        <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          Close the report tab that opened to finish.
        </div>
      )}

      {ringActive && (
        <p className="text-xs text-muted-foreground/60">
          Continuous capture: buffering in background
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button className="w-full" onClick={stopSession} disabled={isStopping}>
        <Square className="h-3 w-3 fill-current" />
        Stop &amp; report
      </Button>
      <p className="text-center text-[10px] text-muted-foreground/60 -mt-2">⌥⇧S</p>

      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={takeScreenshot}
          disabled={screenshotConfirm || isStopping}
        >
          <Camera className="h-4 w-4" />
          {screenshotConfirm ? "Screenshot ✓" : "Screenshot"}
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          onClick={snapshotDom}
          disabled={snapshotConfirm || isStopping}
        >
          <FileCode className="h-4 w-4" />
          {snapshotConfirm ? "Snapshot ✓" : "Snapshot DOM"}
        </Button>
      </div>

      {discardPending ? (
        <div className="flex items-center justify-center gap-2 py-0.5">
          <span className="text-xs text-muted-foreground">Discard all captured data?</span>
          <Button
            variant="destructive"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={confirmDiscard}
          >
            Discard
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setDiscardPending(false)}
          >
            Keep
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-destructive hover:text-destructive"
          onClick={() => setDiscardPending(true)}
        >
          × Discard session
        </Button>
      )}
    </div>
  );
}

export default function App() {
  const { session, loading } = useSession();
  const surface = useSurface();
  const [initialConfig, setInitialConfig] = useState<CaptureConfig>(DEFAULT_CAPTURE_CONFIG);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [currentTabId, setCurrentTabId] = useState<number | null>(null);
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);

  // Offer promotion to the side panel only from the popup, only when the flag is
  // on, and only where the browser supports it (Chromium 114+ / Firefox).
  const showOpenInPanel =
    surface === "popup" && settingsLoaded && initialConfig.sidePanel && canOpenSidePanel();
  // Not async: chrome.sidePanel.open() must run synchronously in the click
  // handler or it loses the user activation and rejects. The window/tab id were
  // pre-fetched on mount precisely so we don't have to await here.
  const promoteToSidePanel = () => {
    const options =
      currentWindowId != null
        ? { windowId: currentWindowId }
        : currentTabId != null
          ? { tabId: currentTabId }
          : null;
    if (!options) return;
    openSidePanel(options)
      .then(() => window.close())
      .catch((e) => console.warn("Failed to open side panel", e));
  };

  useEffect(() => {
    sendToBackground<{ captureConfig: CaptureConfig }>({ type: "get-settings" })
      .then(({ captureConfig }) => setInitialConfig(captureConfig))
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));

    chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (tab?.id != null) setCurrentTabId(tab.id);
        if (tab?.windowId != null) setCurrentWindowId(tab.windowId);
      })
      .catch(() => {});
  }, []);

  return (
    <div
      className={`${surface === "sidepanel" ? "w-full" : "w-[380px]"} bg-background text-foreground`}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          <Logo className="h-5 w-5" />
          <span className="text-sm font-semibold tracking-tight">Browser Recorder</span>
        </div>
        <div className="flex items-center gap-2">
          {showOpenInPanel && (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={promoteToSidePanel}
              aria-label="Open in side panel"
              title="Open in side panel"
            >
              <PanelRight className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => chrome.runtime.openOptionsPage()}
            aria-label="Settings"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!loading &&
        settingsLoaded &&
        (session ? (
          <ActiveView currentTabId={currentTabId} />
        ) : (
          <IdleView initialConfig={initialConfig} />
        ))}
    </div>
  );
}
