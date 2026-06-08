#!/usr/bin/env node
import { Command } from "commander";
import { recordCommand } from "./commands/record.js";
import { runCommand } from "./commands/run.js";

const program = new Command();

program
  .name("browser-recorder")
  .description("Capture browser events and export a zip report")
  .version("0.1.0");

program
  .command("record")
  .description(
    "Attach to a running browser via CDP and capture events. Supports any Chromium-based browser " +
      "(Chrome, Edge, Brave, Arc, …) launched with --remote-debugging-port. " +
      "Firefox/WebKit do not support CDP attach — use 'run' instead.",
  )
  .option("-p, --port <port>", "Remote debugging port", "9222")
  .option(
    "-b, --browser <name>",
    "Browser hint for error messages: chromium | chrome | msedge | brave (default: chromium)",
    "chromium",
  )
  .option("-o, --output <path>", "Output zip path", "./report.zip")
  .option("-t, --title <title>", "Report title (skips prompt)")
  .option("-d, --description <desc>", "Report description (skips prompt)")
  .option("-n, --notes <notes>", "Report notes (skips prompt)")
  .action(recordCommand);

program
  .command("run")
  .description("Launch a browser, run a Playwright script, and export events")
  .requiredOption("-s, --script <path>", "Path to the script to run")
  .option(
    "-b, --browser <name>",
    "Browser: chromium | firefox | webkit | chrome | msedge (default: chromium)",
    "chromium",
  )
  .option("-e, --executable <path>", "Path to a custom browser executable (Brave, Arc, …)")
  .option("-o, --output <path>", "Output zip path", "./report.zip")
  .option("-t, --title <title>", "Report title (skips prompt)")
  .option("-d, --description <desc>", "Report description (skips prompt)")
  .option("-n, --notes <notes>", "Report notes (skips prompt)")
  .option("--headless", "Run browser in headless mode", false)
  .action(runCommand);

program.parse();
