import { input } from "@inquirer/prompts";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import type { Page } from "playwright";
import { BrowserCapture } from "../lib/capture.js";
import { exportZip } from "../lib/export.js";
import { launchBrowser } from "../lib/browser.js";
import type { BrowserName } from "../lib/browser.js";

interface RunOptions {
  script: string;
  output: string;
  title?: string;
  description?: string;
  notes?: string;
  headless?: boolean;
  browser?: string;
  executable?: string;
}

type UserScript = { default: (page: Page) => Promise<void> };

async function loadScript(scriptUrl: string, scriptPath: string): Promise<UserScript> {
  let mod: unknown;
  try {
    mod = await import(scriptUrl);
  } catch (err) {
    console.error(`Failed to import script: ${scriptPath}`);
    console.error(err);
    process.exit(1);
  }

  const userScript = mod as UserScript;
  if (typeof userScript.default !== "function") {
    console.error("Script must have a default export that is a function.");
    process.exit(1);
  }

  return userScript;
}

export async function runCommand(options: RunOptions): Promise<void> {
  const scriptPath = resolve(options.script);
  const scriptUrl = pathToFileURL(scriptPath).href;
  const browserName = (options.browser ?? "chromium") as BrowserName;

  console.log(`Launching ${browserName}...`);
  const browser = await launchBrowser(browserName, {
    headless: options.headless ?? false,
    executablePath: options.executable,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const capture = new BrowserCapture(page);
  capture.attach();

  console.log(`Running script: ${scriptPath}`);

  const userScript = await loadScript(scriptUrl, scriptPath);

  try {
    await userScript.default(page);
  } catch (err) {
    console.error("Script threw an error:", err);
  }

  console.log("Script complete. Flushing interactions...");
  await capture.flushInteractions();

  const finalUrl = page.url();

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
      url: finalUrl !== "about:blank" ? finalUrl : options.script,
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
