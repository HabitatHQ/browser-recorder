import { readFileSync } from "node:fs"
import tailwindcss from "@tailwindcss/vite"
import { type Plugin, defineConfig } from "wxt"

// Single source of truth for the repo URL: package.json → manifest.homepage_url →
// chrome.runtime.getManifest() at runtime. Keeps the repo slug out of the code.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  homepage?: string
}

// chrome.scripting.executeScript validates injected files with base::IsStringUTF8,
// which rejects Unicode *non-characters* (U+FDD0–U+FDEF, U+FFFE/U+FFFF) even though
// they're valid UTF-8. rrweb's bundle embeds a raw U+FFFE in its CSS-BOM check, so
// the injected replay-record.js fails to load with "isn't UTF-8 encoded". Escaping
// those code points to \uXXXX keeps the strings identical at runtime while making
// the file bytes injectable. Targeted (not a full ASCII pass) to minimize churn.
function escapeUtf8NonCharacters(): Plugin {
  return {
    name: "escape-utf8-noncharacters",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk") continue;
        file.code = file.code.replace(
          new RegExp("[\\uFDD0-\\uFDEF\\uFFFE\\uFFFF]", "g"),
          (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`
        );
      }
    },
  };
}

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss(), escapeUtf8NonCharacters()],
  }),
  manifest: ({ browser }) => {
    const isFirefox = browser === "firefox";
    // The `key` pins a stable extension ID for local unpacked loads. The Chrome
    // Web Store assigns its own key/ID, and a mismatching `key` makes store
    // uploads fail — so strip it for store builds (CWS_BUILD=1).
    const isStoreBuild = process.env.CWS_BUILD === "1";
    return {
      name: "Browser Recorder",
      short_name: "Recorder",
      description: "Capture console, network, interactions and DOM snapshots for bug reports",
      ...(pkg.homepage && { homepage_url: pkg.homepage }),
      action: {
        default_title: "Browser Recorder",
        default_popup: "popup.html",
      },
      options_ui: {
        page: "options.html",
        open_in_tab: true,
      },
      commands: {
        "start-session": {
          description: "Start capture session",
          suggested_key: { default: "Alt+Shift+R", mac: "Alt+Shift+R" },
        },
        "stop-session": {
          description: "Stop session and open report",
          suggested_key: { default: "Alt+Shift+S", mac: "Alt+Shift+S" },
        },
        "take-screenshot": {
          description: "Take screenshot (standalone or during session)",
          suggested_key: { default: "Alt+Shift+C", mac: "Alt+Shift+C" },
        },
        "snapshot-dom": {
          description: "Capture DOM snapshot (standalone or during session)",
          suggested_key: { default: "Alt+Shift+D", mac: "Alt+Shift+D" },
        },
      },
      permissions: [
        "activeTab",
        "management",
        "scripting",
        "storage",
        "tabs",
        ...(!isFirefox ? (["tabCapture", "offscreen"] as const) : []),
      ],
      host_permissions: ["<all_urls>"],
      ...(!isFirefox &&
        !isStoreBuild && {
          key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqMJOHRmc9Xix5QczXMbZjdFGsglwBDQvWxXMvlvJ3gvXJxDqwBGp8CXAgu3mAwjtcEAFD0+gCRlOCswKXC4PEUZsLWbUK+x+85sDtWZjH3Z0Nd4FV20F1qxx5ZWi/sUaexoJMaUmbmZ+G32n97NlhIyTag3KdgyKhQmX8DBNSMEK5mW1SuoFGouiMjwdnWESQYGLcZMn/yg9EF5A8/QqOQn6sYXSTHxdkXkJKrTMt+HgVqn1xuAMrHhMFQ51v2YyxO5PysLqFGP+HUOD1xyN1sBU41+tHNnJNFzvdjeZ73cUstdiDtGah8D6jpeVtTH1LTqGfpLeN/1thkNkgytmBQIDAQAB",
        }),
      ...(isFirefox && {
        browser_specific_settings: {
          gecko: {
            id: "browser-recorder@npalladium.dev",
            strict_min_version: "128.0",
          },
        },
      }),
    };
  },
  manifestVersion: 3,
  zip: {
    excludeSources: ["scratch/**"],
  },
})
