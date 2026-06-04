import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "wxt"

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: "Chrome Recorder",
    short_name: "Recorder",
    description: "Capture console, network, interactions and DOM snapshots for bug reports",
    version: "0.1.0",
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
      "scripting",
      "storage",
      "tabs",
      "tabCapture",
      "offscreen",
    ],
    host_permissions: ["<all_urls>"],
  },
  manifestVersion: 3,
})
