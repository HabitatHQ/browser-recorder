import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "wxt"

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser }) => {
    const isFirefox = browser === "firefox";
    return {
      name: "Chrome Recorder",
      short_name: "Recorder",
      description: "Capture console, network, interactions and DOM snapshots for bug reports",
      action: {
        default_title: "Chrome Recorder",
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
      ...(isFirefox && {
        browser_specific_settings: {
          gecko: {
            id: "chrome-recorder@npalladium.dev",
            strict_min_version: "128.0",
          },
        },
      }),
    };
  },
  manifestVersion: 3,
})
