import { chromium } from "playwright";
import { input } from "@inquirer/prompts";
import { BrowserCapture } from "../lib/capture.js";
import { exportZip } from "../lib/export.js";
import { CDP_ONLY } from "../lib/browser.js";
import type { BrowserName } from "../lib/browser.js";

interface RecordOptions {
  port: string;
  output: string;
  title?: string;
  description?: string;
  notes?: string;
  browser?: string;
}

const CDP_LAUNCH_HINTS: Record<string, string> = {
  chrome: "--remote-debugging-port=9222",
  msedge: "--remote-debugging-port=9222",
  brave: "--remote-debugging-port=9222",
  arc: "--remote-debugging-port=9222",
};

async function connectOrExit(cdpUrl: string, browserName: string) {
  try {
    return await chromium.connectOverCDP(cdpUrl);
  } catch (err) {
    const hint = CDP_LAUNCH_HINTS[browserName] ?? "--remote-debugging-port=9222";
    const portStr = new URL(cdpUrl).port;
    console.error(
      `Failed to connect to ${browserName} at ${cdpUrl}.\n` +
        `Make sure ${browserName} is running with ${hint.replace("9222", portStr)}`,
    );
    console.error(err);
    process.exit(1);
  }
}

export async function recordCommand(options: RecordOptions): Promise<void> {
  const browserName = (options.browser ?? "chromium") as BrowserName;

  if (!CDP_ONLY.includes(browserName)) {
    console.error(
      `'${browserName}' does not support CDP remote attach.\n` +
        `Use 'run' mode instead:\n` +
        `  browser-recorder run --browser ${browserName} --script ./steps.js`,
    );
    process.exit(1);
  }

  const port = parseInt(options.port, 10);
  const cdpUrl = `http://localhost:${port}`;

  console.log(`Connecting to ${browserName} on ${cdpUrl} ...`);
  const browser = await connectOrExit(cdpUrl, browserName);

  const contexts = browser.contexts();
  if (contexts.length === 0) {
    console.error("No browser contexts found.");
    await browser.close();
    process.exit(1);
  }

  const pages = contexts.flatMap((ctx) => ctx.pages());
  if (pages.length === 0) {
    console.error("No pages found in the browser.");
    await browser.close();
    process.exit(1);
  }

  let page = pages[0];
  if (pages.length > 1) {
    console.log("Available pages:");
    pages.forEach((p, i) => {
      console.log(`  [${i}] ${p.url()}`);
    });
    const choice = await input({
      message: "Select page index:",
      default: "0",
      validate: (v) => {
        const n = parseInt(v, 10);
        return n >= 0 && n < pages.length ? true : `Enter a number 0-${pages.length - 1}`;
      },
    });
    page = pages[parseInt(choice, 10)];
  }

  const sessionUrl = page.url();
  console.log(`Attaching capture to: ${sessionUrl}`);

  const capture = new BrowserCapture(page);
  capture.attach();

  console.log("Capture started. Press Ctrl+C to stop and export.");

  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      resolve();
    });
  });

  console.log("\nStopping capture...");
  await capture.flushInteractions();

  const title = options.title ?? (await input({ message: "Title:", default: "Bug report" }));
  const description =
    options.description ?? (await input({ message: "Description:", default: "" }));
  const notes = options.notes ?? (await input({ message: "Notes:", default: "" }));

  const screenshot = await capture.takeScreenshot().catch(() => null);
  const domHtml = await capture.takeDomSnapshot().catch(() => null);

  await exportZip(
    {
      title,
      description,
      notes,
      url: sessionUrl,
      startedAt: capture.startedAt,
      consoleEvents: capture.getConsoleEvents(),
      networkEvents: capture.getNetworkEvents(),
      interactions: capture.getInteractions(),
      screenshots: screenshot ? [screenshot] : [],
      domSnapshots: domHtml ? { end: domHtml } : {},
    },
    options.output,
  );

  console.log(`Report saved to ${options.output}`);
  await browser.close();
}
