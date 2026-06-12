#!/usr/bin/env node
// Rasterizes public/icon/icon.svg into the PNG sizes WXT picks up for the
// manifest icons + toolbar action icon. Run after editing the SVG.
//
// Usage: node scripts/generate-icons.mjs

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, "..");
const ICON_DIR = resolve(REPO, "public/icon");
const SVG_PATH = resolve(ICON_DIR, "icon.svg");

// WXT auto-detects public/icon/{size}.png and wires them into the manifest.
const SIZES = [16, 32, 48, 128];

async function main() {
  const svg = await readFile(SVG_PATH, "utf8");
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<!doctype html><html><body style="margin:0">
         <div style="width:${size}px;height:${size}px">${svg.replace(
           "<svg ",
           `<svg width="${size}" height="${size}" `
         )}</div>
       </body></html>`,
      { waitUntil: "load" }
    );
    const png = await page.screenshot({ omitBackground: true, type: "png" });
    const out = resolve(ICON_DIR, `${size}.png`);
    await writeFile(out, png);
    console.log(`✓ ${out} (${size}x${size})`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
