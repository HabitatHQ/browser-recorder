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

// Must be called from a user gesture (e.g. a popup button click).
export async function openSidePanel(): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.sidePanel) {
    const win = await chrome.windows.getCurrent();
    if (win.id != null) await chrome.sidePanel.open({ windowId: win.id });
    return;
  }
  await getSidebarAction()?.open();
}
