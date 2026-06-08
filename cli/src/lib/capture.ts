import type { Page, Request } from "playwright";
import type {
  DebuggerConsoleEvent,
  DebuggerNetworkEvent,
  DebuggerActionEvent,
} from "@browser-recorder/core";

export class BrowserCapture {
  readonly startedAt: number;
  private consoleEvents: DebuggerConsoleEvent[] = [];
  private networkRequests: Map<string, { req: Request; startMs: number }> = new Map();
  private networkEvents: DebuggerNetworkEvent[] = [];
  private interactions: DebuggerActionEvent[] = [];

  constructor(private page: Page) {
    this.startedAt = Date.now();
  }

  attach(): void {
    // console
    this.page.on("console", (msg) => {
      const level = msg.type() as DebuggerConsoleEvent["level"];
      if (!["log", "info", "warn", "error", "debug"].includes(level)) return;
      this.consoleEvents.push({
        kind: "console",
        timestamp: Date.now(),
        level,
        message: msg.text(),
      });
    });
    this.page.on("pageerror", (err) => {
      this.consoleEvents.push({
        kind: "console",
        timestamp: Date.now(),
        level: "error",
        message: `[uncaught] ${err.message}`,
      });
    });

    // network — track request start times, emit on finish
    this.page.on("request", (req) => {
      this.networkRequests.set(req.url() + req.method() + String(Date.now()), {
        req,
        startMs: Date.now(),
      });
    });
    this.page.on("response", async (resp) => {
      const req = resp.request();
      const key = [...this.networkRequests.keys()].find((k) =>
        k.startsWith(req.url() + req.method()),
      );
      const startMs = key ? this.networkRequests.get(key)!.startMs : Date.now();
      if (key) this.networkRequests.delete(key);
      let responseBody: string | undefined;
      try {
        responseBody = (await resp.body()).toString("utf8").slice(0, 10_000);
      } catch {
        /* ignore */
      }
      let requestBody: string | undefined;
      try {
        requestBody = req.postData() ?? undefined;
      } catch {
        /* ignore */
      }
      this.networkEvents.push({
        kind: "network",
        timestamp: startMs,
        method: req.method(),
        url: req.url(),
        status: resp.status(),
        duration: Date.now() - startMs,
        requestHeaders: Object.fromEntries(Object.entries(req.headers())),
        responseHeaders: Object.fromEntries(Object.entries(resp.headers())),
        requestBody,
        responseBody,
      });
    });

    // interactions — inject listener into every page/frame
    this.page.addInitScript(() => {
      const emit = (
        actionType: string,
        target: EventTarget | null,
        metadata?: Record<string, unknown>,
      ) => {
        const el = target as HTMLElement | null;
        const selector = el?.id
          ? `#${el.id}`
          : el?.className
            ? `.${el.className.split(" ")[0]}`
            : el?.tagName?.toLowerCase() ?? "";
        const w = window as unknown as Record<string, unknown[]>;
        w.__brInteractions ??= [];
        w.__brInteractions.push({
          actionType,
          target: selector,
          timestamp: Date.now(),
          metadata,
        });
      };
      document.addEventListener("click", (e) => emit("click", e.target), true);
      document.addEventListener(
        "input",
        (e) =>
          emit("input", e.target, {
            value: (e.target as HTMLInputElement)?.value?.slice(0, 200),
          }),
        true,
      );
      document.addEventListener("submit", (e) => emit("submit", e.target), true);
      window.addEventListener("popstate", () =>
        emit("navigation", null, { url: location.href }),
      );
    });
  }

  async flushInteractions(): Promise<void> {
    try {
      const raw = await this.page.evaluate(
        () =>
          ((window as unknown as Record<string, unknown>).__brInteractions as unknown[]) ?? [],
      );
      for (const ev of raw as Array<{
        actionType: string;
        target: string;
        timestamp: number;
        metadata?: Record<string, unknown>;
      }>) {
        this.interactions.push({
          kind: "action",
          actionType: ev.actionType,
          target: ev.target,
          timestamp: ev.timestamp,
          metadata: ev.metadata,
        });
      }
      await this.page.evaluate(() => {
        (window as unknown as Record<string, unknown>).__brInteractions = [];
      });
    } catch {
      /* page may have navigated */
    }
  }

  async takeScreenshot(): Promise<Buffer> {
    return this.page.screenshot({ type: "png" });
  }

  async takeDomSnapshot(): Promise<string> {
    return this.page.content();
  }

  getConsoleEvents(): DebuggerConsoleEvent[] {
    return this.consoleEvents;
  }
  getNetworkEvents(): DebuggerNetworkEvent[] {
    return this.networkEvents;
  }
  getInteractions(): DebuggerActionEvent[] {
    return this.interactions;
  }
}
