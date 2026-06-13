import { MAX_BODY_LENGTH } from "../constants";
import type { Reporter } from "../types";
import { toAbsoluteUrl, truncate } from "../utils";

export interface SSEPayload {
  url: string;
  event: "open" | "error" | "message";
  data?: string;
  eventType?: string;
  lastEventId?: string;
}

interface SSECaptureInput {
  reporter: Reporter;
  postSSE: (payload: SSEPayload) => void;
}

export function installSSECapture({ reporter, postSSE }: SSECaptureInput): void {
  if (!("EventSource" in window)) return;

  const Original = window.EventSource;

  window.EventSource = new Proxy(Original, {
    construct(Target, args: ConstructorParameters<typeof EventSource>) {
      const es = new Target(...args);
      const url = toAbsoluteUrl(String(args[0] ?? ""), reporter) ?? String(args[0] ?? "");

      es.addEventListener("open", () => postSSE({ url, event: "open" }));
      es.addEventListener("error", () => postSSE({ url, event: "error" }));
      es.addEventListener("message", (e: MessageEvent) =>
        postSSE({
          url,
          event: "message",
          data: truncate(String(e.data), MAX_BODY_LENGTH),
          lastEventId: e.lastEventId || undefined,
        })
      );

      // Intercept addEventListener so named event types are also captured
      const originalAdd = es.addEventListener.bind(es);
      // biome-ignore lint/suspicious/noExplicitAny: generic event listener signature
      (es as any).addEventListener = (
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
      ) => {
        if (type !== "open" && type !== "error" && type !== "message") {
          const wrapped = (e: Event) => {
            if (e instanceof MessageEvent) {
              postSSE({
                url,
                event: "message",
                eventType: type,
                data: truncate(String(e.data), MAX_BODY_LENGTH),
                lastEventId: e.lastEventId || undefined,
              });
            }
            if (typeof listener === "function") listener(e);
            else listener.handleEvent(e);
          };
          return originalAdd(type, wrapped, options);
        }
        return originalAdd(type, listener, options);
      };

      return es;
    },
  }) as typeof EventSource;
}
