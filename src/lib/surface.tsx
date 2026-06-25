import { type ReactNode, createContext, useContext } from "react";

// Which UI surface the shared recorder App is rendered in. The popup is dismissed
// (window.close) after each action because it can't survive losing focus; the side
// panel is persistent chrome and must stay open while the user interacts with the
// page being recorded. Components read this to decide whether to self-dismiss.
export type Surface = "popup" | "sidepanel";

const SurfaceContext = createContext<Surface>("popup");

export function SurfaceProvider({
  surface,
  children,
}: {
  surface: Surface;
  children: ReactNode;
}) {
  return <SurfaceContext.Provider value={surface}>{children}</SurfaceContext.Provider>;
}

export function useSurface(): Surface {
  return useContext(SurfaceContext);
}

// Returns a dismiss fn that closes the popup but is a no-op in the side panel,
// where the same view should simply re-render to reflect the new session state.
export function useDismiss(): () => void {
  const surface = useSurface();
  return () => {
    if (surface === "popup") window.close();
  };
}

// Firefox exposes the sidebar under browser.sidebarAction; @types/chrome doesn't
// cover it, so describe the one method we call.
interface SidebarActionApi {
  open: () => Promise<void>;
}

function getSidebarAction(): SidebarActionApi | undefined {
  return (globalThis as { browser?: { sidebarAction?: SidebarActionApi } }).browser?.sidebarAction;
}

// Runtime feature detection — Chromium 114+ (side panel), Firefox (sidebar), or
// neither (Safari, old Chromium → fall back to the popup).
export function canOpenSidePanel(): boolean {
  return (typeof chrome !== "undefined" && !!chrome.sidePanel) || !!getSidebarAction();
}

// Must be called synchronously from a user gesture (a popup button click).
// chrome.sidePanel.open() rejects if the user activation is gone, and *any*
// awaited call beforehand (e.g. chrome.windows.getCurrent) consumes it — so the
// caller pre-fetches the windowId/tabId and we invoke open() with no await first.
export function openSidePanel(options: chrome.sidePanel.OpenOptions): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.sidePanel) {
    return chrome.sidePanel.open(options);
  }
  const sidebar = getSidebarAction();
  return sidebar ? sidebar.open() : Promise.resolve();
}
