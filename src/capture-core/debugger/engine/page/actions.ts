import { getElementTarget } from "./utils";

interface ActionCaptureInput {
  postAction: (
    actionType: string,
    target: string | undefined,
    metadata?: Record<string, unknown>
  ) => void;
  fullSelectorPath?: boolean;
}

export function installActionAndNavigationCapture(input: ActionCaptureInput): void {
  const { postAction, fullSelectorPath = true } = input;

  const postNavigationBreadcrumb = (mode: string) => {
    postAction("navigation", "window", {
      mode,
      url: location.href,
      path: location.pathname,
      search: location.search,
      hash: location.hash,
      title: document.title,
    });
  };

  const getElementMeta = (el: EventTarget | null): Record<string, unknown> => {
    if (!(el instanceof Element)) return {};
    const meta: Record<string, unknown> = {};
    const label =
      el.getAttribute("aria-label") ??
      el.getAttribute("title") ??
      el.getAttribute("placeholder") ??
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
        ? el.getAttribute("name")
        : null);
    if (label) meta.label = label;
    const text = el.textContent?.trim().slice(0, 80);
    if (text) meta.text = text;
    if (el instanceof HTMLInputElement) meta.inputType = el.type;
    if (el instanceof HTMLAnchorElement && el.href) meta.href = el.href;
    return meta;
  };

  const delegatedHandlers: Record<"click" | "input" | "change", (event: Event) => void> = {
    click: (event) => {
      postAction(
        "click",
        getElementTarget(event.target, fullSelectorPath),
        getElementMeta(event.target)
      );
    },
    input: (event) => {
      const target = getElementTarget(event.target, fullSelectorPath);
      const meta = getElementMeta(event.target);

      const inputTarget = event.target;
      if (inputTarget instanceof HTMLInputElement || inputTarget instanceof HTMLTextAreaElement) {
        meta.valueLength = inputTarget.value.length;
      }

      postAction("input", target, meta);
    },
    change: (event) => {
      postAction(
        "change",
        getElementTarget(event.target, fullSelectorPath),
        getElementMeta(event.target)
      );
    },
  };

  const delegatedListener = (event: Event) => {
    if (event.type !== "click" && event.type !== "input" && event.type !== "change") {
      return;
    }

    delegatedHandlers[event.type](event);
  };

  for (const eventType of ["click", "input", "change"] as const) {
    document.addEventListener(eventType, delegatedListener, {
      capture: true,
      passive: true,
    });
  }

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    postNavigationBreadcrumb("pushState");
  };

  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    postNavigationBreadcrumb("replaceState");
  };

  window.addEventListener(
    "popstate",
    () => {
      postNavigationBreadcrumb("popstate");
    },
    {
      capture: true,
      passive: true,
    }
  );

  window.addEventListener(
    "hashchange",
    () => {
      postNavigationBreadcrumb("hashchange");
    },
    {
      capture: true,
      passive: true,
    }
  );

  postNavigationBreadcrumb("initial");
}
