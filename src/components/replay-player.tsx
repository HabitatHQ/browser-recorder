import { stripReplayAutofocus } from "@/lib/replay-preprocess";
import { replayRuntimeUrl, replayStyles } from "@/lib/replay-runtime";
import { useEffect, useRef, useState } from "react";

// In-extension session replay. The player runs the same packaged UMD runtime
// that export embeds into replay.html, avoiding a second ESM copy of rrweb.
const BOX_WIDTH = 760;

interface ReplayController {
  getCurrentTime(): number;
  getMetaData(): { totalTime: number };
  on(event: "finish", listener: () => void): void;
  pause(time?: number): void;
  play(time?: number): void;
}

interface ReplayRuntime {
  Replayer: new (
    events: unknown[],
    options: { root: HTMLElement; showWarning: boolean; mouseTail: boolean }
  ) => ReplayController;
}

type ReplayWindow = Window &
  typeof globalThis & {
    rrweb?: ReplayRuntime;
  };

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const PREVIEW_DOCUMENT = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>${replayStyles}</style>
<style>
  html, body { margin: 0; overflow: hidden; background: #fff; }
  #replay-root { width: 100%; }
</style>
</head>
<body>
<div id="replay-root"></div>
<script src="${escapeAttribute(replayRuntimeUrl)}"></script>
</body>
</html>`;

function fmt(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ReplayPlayer({
  events,
  stripAutofocus = false,
}: {
  events: unknown[];
  stripAutofocus?: boolean;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const replayerRef = useRef<ReplayController | null>(null);
  const rafRef = useRef(0);
  const [runtimeGeneration, setRuntimeGeneration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(0);
  const [boxHeight, setBoxHeight] = useState(440);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    const frameWindow = frame?.contentWindow as ReplayWindow | null;
    const root = frameWindow?.document.getElementById("replay-root");
    if (!runtimeGeneration || !frameWindow || !root || events.length < 2) return;

    root.replaceChildren();
    setError(null);
    setPlaying(false);
    setCurrent(0);

    const replayEvents = stripAutofocus ? stripReplayAutofocus(events) : events;
    const RuntimeReplayer = frameWindow.rrweb?.Replayer;
    if (!RuntimeReplayer) {
      setError("The packaged replay runtime did not load");
      return;
    }

    let replayer: ReplayController;
    try {
      replayer = new RuntimeReplayer(replayEvents, {
        root,
        showWarning: false,
        mouseTail: false,
      });
    } catch (err) {
      setError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      return;
    }

    replayerRef.current = replayer;
    const totalTime = replayer.getMetaData().totalTime;
    setTotal(totalTime);

    const metaEvent = events.find(
      (event) => typeof event === "object" && event !== null && "type" in event && event.type === 4
    ) as { data?: { width?: number; height?: number } } | undefined;
    const recW = metaEvent?.data?.width ?? BOX_WIDTH;
    const recH = metaEvent?.data?.height ?? 480;
    const scale = Math.min(1, BOX_WIDTH / recW);
    const wrapper = root.querySelector<HTMLElement>(".replayer-wrapper");
    if (wrapper) {
      wrapper.style.transform = `scale(${scale})`;
      wrapper.style.transformOrigin = "top left";
    }
    setBoxHeight(Math.ceil(recH * scale));

    replayer.pause(0);
    replayer.on("finish", () => {
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
    });

    return () => {
      cancelAnimationFrame(rafRef.current);
      try {
        replayer.pause();
      } catch {
        // Already torn down.
      }
      root.replaceChildren();
      replayerRef.current = null;
    };
  }, [events, runtimeGeneration, stripAutofocus]);

  const tick = () => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    setCurrent(Math.min(replayer.getCurrentTime(), total));
    rafRef.current = requestAnimationFrame(tick);
  };

  const play = () => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    replayer.play(current >= total ? 0 : current);
    setPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  };

  const pause = () => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    replayer.pause();
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  };

  const seek = (time: number) => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    setCurrent(time);
    if (playing) replayer.play(time);
    else replayer.pause(time);
  };

  if (events.length < 2) return null;

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Replay player error: {error}
        </div>
      )}
      <iframe
        ref={frameRef}
        title="Session replay"
        srcDoc={PREVIEW_DOCUMENT}
        onLoad={() => setRuntimeGeneration((generation) => generation + 1)}
        className="block overflow-hidden rounded-lg border border-border bg-white"
        style={{ width: BOX_WIDTH, height: boxHeight }}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={playing ? pause : play}
          className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={total || 1}
          value={current}
          onChange={(event) => seek(Number(event.target.value))}
          className="flex-1 accent-primary"
        />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {fmt(current)} / {fmt(total)}
        </span>
      </div>
    </div>
  );
}
