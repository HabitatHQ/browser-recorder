#!/usr/bin/env node
// Captures README screenshots of the extension UI by loading the built
// unpacked extension into Chromium and rendering its pages.
//
// Usage:
//   pnpm build                 # produce .output/chrome-mv3 first
//   node scripts/capture-screenshots.mjs
//
// Env:
//   HEADLESS=1   run without a visible window (extension pages still render
//                via Chromium's new headless mode)
//
// Output: docs/screenshots/*.png

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const EXT_DIR = resolve(REPO, ".output/chrome-mv3");
const OUT_DIR = resolve(REPO, "docs/screenshots");

const HEADLESS = process.env.HEADLESS === "1";

// Each shot: an extension page to render, the viewport to render it in, and a
// selector to wait for so we never capture a half-painted frame.
const SHOTS = [
  {
    name: "popup",
    page: "popup.html",
    viewport: { width: 380, height: 700 },
    waitFor: "text=Start session",
  },
  {
    name: "options",
    page: "options.html",
    viewport: { width: 760, height: 1100 },
    waitFor: "text=Network",
  },
  {
    name: "recorder",
    page: "recorder.html",
    viewport: { width: 1120, height: 520 },
    waitFor: "text=Review",
  },
];

async function main() {
  if (!existsSync(EXT_DIR)) {
    console.error(`Build not found at ${EXT_DIR} — run \`pnpm build\` first.`);
    process.exit(1);
  }
  await mkdir(OUT_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext("", {
    headless: HEADLESS,
    channel: HEADLESS ? "chromium" : undefined,
    colorScheme: "light",
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
    ],
  });

  // The background service worker URL carries the extension's runtime ID.
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extId = new URL(sw.url()).host;
  console.log(`Extension ID: ${extId}`);

  // Give the popup a real active tab to query.
  const seed = await context.newPage();
  await seed.goto("https://example.com", { waitUntil: "domcontentloaded" }).catch(() => {});

  for (const shot of SHOTS) {
    const page = await context.newPage();
    await page.setViewportSize(shot.viewport);
    await page.goto(`chrome-extension://${extId}/${shot.page}`, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector(shot.waitFor, { timeout: 15_000 }).catch(() => {
      console.warn(`  (selector "${shot.waitFor}" not found for ${shot.name})`);
    });
    // Let fonts/layout settle.
    await page.waitForTimeout(500);
    const out = resolve(OUT_DIR, `${shot.name}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`✓ ${shot.name} → ${out}`);
    await page.close();
  }

  await context.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
