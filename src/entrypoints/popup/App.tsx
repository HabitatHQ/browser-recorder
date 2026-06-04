import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { formatDuration, useElapsedMs, useSession } from "@/hooks/use-session";
import { sendToBackground } from "@/lib/messaging";
import { type CaptureConfig, DEFAULT_CAPTURE_CONFIG } from "@/lib/types";
import {
  Camera,
  Circle,
  Code,
  FileCode,
  Loader2,
  MousePointer,
  Network,
  Settings,
  Square,
  Video,
} from "lucide-react";
import { useEffect, useState } from "react";

const CONFIRM_FLASH_MS = 1500;

function IdleView({ initialConfig }: { initialConfig: CaptureConfig }) {
  const [config, setConfig] = useState<CaptureConfig>(initialConfig);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (key: keyof CaptureConfig) => setConfig((c) => ({ ...c, [key]: !c[key] }));

  const startSession = async () => {
    setStarting(true);
    setError(null);
    try {
      await sendToBackground({ type: "start-session", captureConfig: config });
      window.close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  };

  const takeScreenshot = async () => {
    try {
      await sendToBackground({ type: "take-screenshot" });
      window.close();
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

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ActiveView() {
  const { session, counts, loading } = useSession();
  const elapsed = useElapsedMs(session?.startedAt ?? null);
  const [snapshotConfirm, setSnapshotConfirm] = useState(false);
  const [screenshotConfirm, setScreenshotConfirm] = useState(false);
  const [discardPending, setDiscardPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      window.close();
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
      window.close();
    });

  if (loading || !session) return null;

  const isStarting = session.status === "starting";
  const isStopping = session.status === "stopping";

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
    counts.interactions > 0 ? `${counts.interactions} int` : null,
    counts.domSnapshots > 0 ? `${counts.domSnapshots} dom` : null,
    counts.screenshots > 0 ? `${counts.screenshots} ss` : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
        <Circle className="h-2.5 w-2.5 fill-destructive text-destructive shrink-0" />
        <span className="font-medium">{isStopping ? "Stopping…" : "Recording"}</span>
        <span className="text-muted-foreground">{formatDuration(elapsed)}</span>
        <span className="text-border">│</span>
        <span className="text-muted-foreground">{statusParts.join(" · ")}</span>
        {counts.errors > 0 && (
          <span className="text-destructive">· {counts.errors} errors</span>
        )}
      </div>

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
            disabled={isStopping}
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
          disabled={isStopping}
        >
          × Discard session
        </Button>
      )}
    </div>
  );
}

export default function App() {
  const { session, loading } = useSession();
  const [initialConfig, setInitialConfig] = useState<CaptureConfig>(DEFAULT_CAPTURE_CONFIG);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    sendToBackground<{ captureConfig: CaptureConfig }>({ type: "get-settings" })
      .then(({ captureConfig }) => setInitialConfig(captureConfig))
      .catch(() => {})
      .finally(() => setSettingsLoaded(true));
  }, []);

  return (
    <div className="w-[380px] bg-background text-foreground">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="text-sm font-semibold tracking-tight">chrome-recorder</span>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => chrome.runtime.openOptionsPage()}
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {!loading &&
        settingsLoaded &&
        (session ? <ActiveView /> : <IdleView initialConfig={initialConfig} />)}
    </div>
  );
}
