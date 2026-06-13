import "rrweb/dist/style.css";
import { useEffect, useRef, useState } from "react";
import { Replayer } from "rrweb";

// In-extension session replay. We drive rrweb's Replayer directly (a plain
// class) rather than rrweb-player, whose 2.0.1 build is a Svelte 5 component
// that renders an empty shell under the legacy `new Player()` API. A small
// custom control bar provides play/pause + scrub.
const BOX_WIDTH = 760;

function fmt(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ReplayPlayer({ events }: { events: unknown[] }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const rafRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState(0);
  const [boxHeight, setBoxHeight] = useState(440);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild only when the events change; total is derived inside.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || events.length < 2) return;
    frame.innerHTML = "";
    setError(null);

    let replayer: Replayer;
    try {
      // biome-ignore lint/suspicious/noExplicitAny: events are loaded from storage as plain JSON.
      replayer = new Replayer(events as any, { root: frame, showWarning: false, mouseTail: false });
    } catch (err) {
      setError(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      return;
    }
    replayerRef.current = replayer;
    const totalTime = replayer.getMetaData().totalTime;
    setTotal(totalTime);

    // Scale the recorded viewport down to fit our fixed-width box.
    // biome-ignore lint/suspicious/noExplicitAny: meta event shape is internal.
    const metaEvent = (events as any[]).find((e) => e?.type === 4);
    const recW: number = metaEvent?.data?.width ?? BOX_WIDTH;
    const recH: number = metaEvent?.data?.height ?? 480;
    const scale = Math.min(1, BOX_WIDTH / recW);
    const wrapper = frame.querySelector<HTMLElement>(".replayer-wrapper");
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
        // already torn down
      }
      frame.innerHTML = "";
      replayerRef.current = null;
    };
  }, [events]);

  const tick = () => {
    const r = replayerRef.current;
    if (!r) return;
    setCurrent(Math.min(r.getCurrentTime(), total));
    rafRef.current = requestAnimationFrame(tick);
  };

  const play = () => {
    const r = replayerRef.current;
    if (!r) return;
    r.play(current >= total ? 0 : current);
    setPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  };

  const pause = () => {
    const r = replayerRef.current;
    if (!r) return;
    r.pause();
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  };

  const seek = (t: number) => {
    const r = replayerRef.current;
    if (!r) return;
    setCurrent(t);
    if (playing) r.play(t);
    else r.pause(t);
  };

  if (events.length < 2) return null;

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Replay player error: {error}
        </div>
      )}
      <div
        className="overflow-hidden rounded-lg border border-border bg-white"
        style={{ width: BOX_WIDTH, height: boxHeight }}
      >
        <div ref={frameRef} />
      </div>
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
          onChange={(e) => seek(Number(e.target.value))}
          className="flex-1 accent-primary"
        />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {fmt(current)} / {fmt(total)}
        </span>
      </div>
    </div>
  );
}
