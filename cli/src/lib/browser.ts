import { chromium, firefox, webkit } from "playwright";
import type { Browser, LaunchOptions } from "playwright";

export type BrowserName = "chromium" | "firefox" | "webkit" | "chrome" | "msedge";

export const CDP_ONLY: BrowserName[] = ["chromium", "chrome", "msedge"];

export async function launchBrowser(
  browser: BrowserName,
  opts: { headless?: boolean; executablePath?: string },
): Promise<Browser> {
  const base: LaunchOptions = {
    headless: opts.headless ?? false,
    ...(opts.executablePath ? { executablePath: opts.executablePath } : {}),
  };

  switch (browser) {
    case "firefox":
      return firefox.launch(base);
    case "webkit":
      return webkit.launch(base);
    case "chrome":
      return chromium.launch({ ...base, channel: "chrome" });
    case "msedge":
      return chromium.launch({ ...base, channel: "msedge" });
    default:
      return chromium.launch(base);
  }
}
