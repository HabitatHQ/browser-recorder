#!/usr/bin/env node
// Captures screenshots of the extension UI by loading the built unpacked
// extension into Chromium and rendering its pages.
//
// Produces two sets:
//   docs/screenshots/*.png  — tight crops for the README
//   docs/store/*.png        — 1280x800 framed images for the Chrome Web Store
//                             listing (drag straight into the dashboard)
//
// Usage:
//   pnpm build                 # produce .output/chrome-mv3 first
//   node scripts/capture-screenshots.mjs
//
// Env:
//   HEADLESS=1   run without a visible window (extension pages still render
//                via Chromium's new headless mode)

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const EXT_DIR = resolve(REPO, ".output/chrome-mv3");
const README_DIR = resolve(REPO, "docs/screenshots");
const STORE_DIR = resolve(REPO, "docs/store");

const HEADLESS = process.env.HEADLESS === "1";

// Chrome Web Store listing screenshots must be exactly 1280x800 (or 640x400).
const STORE_W = 1280;
const STORE_H = 800;

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

// Centers a captured screenshot on a 1280x800 branded background and returns the
// framed PNG. Pure CSS compositing in a headless page — no image-processing dep.
async function frameForStore(context, pngBuffer) {
  const page = await context.newPage();
  await page.setViewportSize({ width: STORE_W, height: STORE_H });
  const dataUrl = `data:image/png;base64,${pngBuffer.toString("base64")}`;
  await page.setContent(
    `<!doctype html><html><body style="margin:0">
       <div style="width:${STORE_W}px;height:${STORE_H}px;display:flex;
                   align-items:center;justify-content:center;
                   background:linear-gradient(135deg,#eef2ff 0%,#e0e7ff 100%);
                   font-family:system-ui,sans-serif">
         <img src="${dataUrl}"
              style="max-width:${STORE_W - 120}px;max-height:${STORE_H - 96}px;
                     border-radius:14px;
                     box-shadow:0 24px 70px rgba(30,41,59,.22),
                                0 4px 12px rgba(30,41,59,.12)" />
       </div>
     </body></html>`,
    { waitUntil: "load" }
  );
  await page.waitForTimeout(200);
  const framed = await page.screenshot({ type: "png" });
  await page.close();
  return framed;
}

async function main() {
  if (!existsSync(EXT_DIR)) {
    console.error(`Build not found at ${EXT_DIR} — run \`pnpm build\` first.`);
    process.exit(1);
  }
  await mkdir(README_DIR, { recursive: true });
  await mkdir(STORE_DIR, { recursive: true });

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
    const raw = await page.screenshot({ fullPage: true, type: "png" });
    await page.close();

    const readmeOut = resolve(README_DIR, `${shot.name}.png`);
    await writeFile(readmeOut, raw);
    console.log(`✓ README ${shot.name} → ${readmeOut}`);

    const framed = await frameForStore(context, raw);
    const storeOut = resolve(STORE_DIR, `${shot.name}.png`);
    await writeFile(storeOut, framed);
    console.log(`✓ store  ${shot.name} → ${storeOut} (${STORE_W}x${STORE_H})`);
  }

  await context.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
