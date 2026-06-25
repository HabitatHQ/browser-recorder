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
    // README crop only: the settings page is far taller than 1280x800, so a
    // store frame shrinks it into an illegible sliver. Not store-suitable.
    readmeOnly: true,
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

// Drives the recorder into its annotation view by seeding a standalone
// screenshot (written to OPFS + session storage from an extension page, exactly
// as the background does) and opening recorder.html?mode=screenshot.
async function captureAnnotation(context, extId, samplePng) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1120, height: 720 });
  // Open an extension page first so chrome.* and the extension-origin OPFS are
  // reachable, then plant the sample screenshot the recorder will pick up.
  await page.goto(`chrome-extension://${extId}/recorder.html`, {
    waitUntil: "domcontentloaded",
  });
  const b64 = samplePng.toString("base64");
  await page.evaluate(async (data) => {
    const filename = "chrome-recorder-screenshot-sample.png";
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const dir = await navigator.storage.getDirectory();
    const handle = await dir.getFileHandle(filename, { create: true });
    const w = await handle.createWritable();
    await w.write(bytes.buffer);
    await w.close();
    await chrome.storage.session.set({ screenshotFilenames: [filename] });
  }, b64);

  await page.goto(`chrome-extension://${extId}/recorder.html?mode=screenshot`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector("canvas", { timeout: 15_000 }).catch(() => {
    console.warn("  (annotation canvas not found)");
  });
  await page.waitForTimeout(600);
  const shot = await page.screenshot({ type: "png" });
  await page.close();
  return shot;
}

// Renders the side panel and composites it docked on the right of a browser
// window showing the page being recorded — because rendered standalone the panel
// is identical to the popup; the docking is what makes it read as a side panel.
async function captureSidePanel(context, extId, pagePng) {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 760 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`, {
    waitUntil: "networkidle",
  });
  await panel.waitForSelector("text=Start session", { timeout: 15_000 }).catch(() => {
    console.warn("  (side panel content not found)");
  });
  await panel.waitForTimeout(500);
  const panelPng = await panel.screenshot({ type: "png" });
  await panel.close();

  // Composite in a headless page: a rounded browser window with a toolbar, the
  // page on the left, and the panel docked on the right.
  const WIN_W = 1180;
  const WIN_H = 740;
  const BAR_H = 44;
  const PANEL_W = 400;
  const PAD = 28;
  const comp = await context.newPage();
  await comp.setViewportSize({ width: WIN_W + PAD * 2, height: WIN_H + PAD * 2 });
  const pageUrl = `data:image/png;base64,${pagePng.toString("base64")}`;
  const panelUrl = `data:image/png;base64,${panelPng.toString("base64")}`;
  const dot = (c) => `<span style="width:12px;height:12px;border-radius:50%;background:${c}"></span>`;
  await comp.setContent(
    `<!doctype html><html><body style="margin:0;padding:${PAD}px;background:transparent;
        font-family:system-ui,sans-serif">
       <div style="width:${WIN_W}px;height:${WIN_H}px;border-radius:12px;overflow:hidden;
                   box-shadow:0 24px 70px rgba(30,41,59,.22),0 4px 12px rgba(30,41,59,.12);
                   background:#fff">
         <div style="height:${BAR_H}px;display:flex;align-items:center;gap:8px;padding:0 16px;
                     background:#f1f5f9;border-bottom:1px solid #e2e8f0">
           ${dot("#ef4444")}${dot("#f59e0b")}${dot("#22c55e")}
           <div style="flex:1;margin:0 12px;height:26px;border-radius:13px;background:#fff;
                       border:1px solid #e2e8f0;display:flex;align-items:center;padding:0 14px;
                       color:#64748b;font-size:12px">example.com</div>
         </div>
         <div style="display:flex;height:${WIN_H - BAR_H}px">
           <img src="${pageUrl}" style="flex:1 1 0;min-width:0;height:100%;object-fit:cover;object-position:top left" />
           <div style="flex:0 0 ${PANEL_W}px;height:100%;border-left:1px solid #e2e8f0;overflow:hidden">
             <img src="${panelUrl}" style="width:${PANEL_W}px;display:block" />
           </div>
         </div>
       </div>
     </body></html>`,
    { waitUntil: "load" }
  );
  await comp.waitForTimeout(200);
  const shot = await comp.screenshot({ type: "png", omitBackground: true });
  await comp.close();
  return shot;
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

  // Give the popup a real active tab to query, and use its screenshot as the
  // sample image for the annotation view.
  const seed = await context.newPage();
  await seed.setViewportSize({ width: 1000, height: 640 });
  await seed.goto("https://example.com", { waitUntil: "networkidle" }).catch(() => {});
  const samplePng = await seed.screenshot({ type: "png" }).catch(() => null);

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

    if (shot.readmeOnly) {
      console.log(`  (store skipped for ${shot.name} — too tall to read at ${STORE_W}x${STORE_H})`);
      continue;
    }

    const framed = await frameForStore(context, raw);
    const storeOut = resolve(STORE_DIR, `${shot.name}.png`);
    await writeFile(storeOut, framed);
    console.log(`✓ store  ${shot.name} → ${storeOut} (${STORE_W}x${STORE_H})`);
  }

  // Side panel (composited next to the page, so it's captured separately).
  if (samplePng) {
    const rawPanel = await captureSidePanel(context, extId, samplePng);
    const panelReadme = resolve(README_DIR, "sidepanel.png");
    await writeFile(panelReadme, rawPanel);
    console.log(`✓ README sidepanel → ${panelReadme}`);
    const panelFramed = await frameForStore(context, rawPanel);
    const panelStore = resolve(STORE_DIR, "sidepanel.png");
    await writeFile(panelStore, panelFramed);
    console.log(`✓ store  sidepanel → ${panelStore} (${STORE_W}x${STORE_H})`);
  }

  // Annotation view (needs a seeded screenshot, so it's captured separately).
  if (samplePng) {
    const rawAnno = await captureAnnotation(context, extId, samplePng);
    const annoReadme = resolve(README_DIR, "annotation.png");
    await writeFile(annoReadme, rawAnno);
    console.log(`✓ README annotation → ${annoReadme}`);
    const annoFramed = await frameForStore(context, rawAnno);
    const annoStore = resolve(STORE_DIR, "annotation.png");
    await writeFile(annoStore, annoFramed);
    console.log(`✓ store  annotation → ${annoStore} (${STORE_W}x${STORE_H})`);
  }

  await context.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
