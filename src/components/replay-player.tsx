import "rrweb-player/dist/style.css";
import { useEffect, useRef } from "react";
import rrwebPlayer from "rrweb-player";

// In-extension rrweb player (experimental). rrweb needs at least the initial
// full-snapshot event plus one more to play, so we render nothing below that.
export function ReplayPlayer({ events }: { events: unknown[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || events.length < 2) return;
    el.innerHTML = "";
    new rrwebPlayer({
      target: el,
      props: {
        // biome-ignore lint/suspicious/noExplicitAny: rrweb's eventWithTime is internal; events are loaded from storage as plain JSON.
        events: events as any,
        width: 760,
        height: 440,
        autoPlay: false,
        showController: true,
      },
    });
    return () => {
      el.innerHTML = "";
    };
  }, [events]);

  if (events.length < 2) return null;
  return <div ref={ref} className="overflow-hidden rounded-lg border border-border" />;
}
