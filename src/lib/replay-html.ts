// Builds a single self-contained HTML file that plays an rrweb session with no
// extension and no network access. rrweb-player ships a UMD bundle that
// registers `window.rrwebPlayer` plus a minified stylesheet; we inline both.
//
// These are imported by relative path because rrweb-player's `exports` map only
// exposes `.` (ESM) and `./dist/style.css` — not the UMD/min files we need for
// a classic <script> inline.
import playerJs from "../../node_modules/rrweb-player/dist/rrweb-player.umd.min.cjs?raw";
import playerCss from "../../node_modules/rrweb-player/dist/style.min.css?raw";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Serialize rrweb events for safe inlining in a <script>. JSON structural chars
 * never include `<`, so escaping `<` to `<` (valid inside JSON strings)
 * prevents a captured page's markup from terminating the script element.
 */
function inlineEventsJson(events: unknown[]): string {
  return JSON.stringify(events).replace(/</g, "\\u003c");
}

export function buildReplayHtml(events: unknown[], title: string): string {
  const safeTitle = escapeHtml(title || "Session replay");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Replay — ${safeTitle}</title>
<style>${playerCss}</style>
<style>
  html, body { margin: 0; background: #16181d; color: #e6e6e6; font: 14px system-ui, sans-serif; }
  .wrap { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 16px; }
  .hint { color: #9aa0aa; }
</style>
</head>
<body>
<div class="wrap">
  <div id="app"></div>
  <div id="empty" class="hint" hidden>No replay data was captured for this session.</div>
</div>
<script>${playerJs}</script>
<script>window.__replayEvents = ${inlineEventsJson(events)};</script>
<script>
(function () {
  var events = window.__replayEvents || [];
  if (events.length < 2) {
    document.getElementById("app").hidden = true;
    document.getElementById("empty").hidden = false;
    return;
  }
  var Player = (window.rrwebPlayer && window.rrwebPlayer.default) || window.rrwebPlayer;
  new Player({
    target: document.getElementById("app"),
    props: {
      events: events,
      width: Math.min(window.innerWidth - 32, 1280),
      height: Math.max(window.innerHeight - 96, 480),
      autoPlay: false,
      showController: true,
    },
  });
})();
</script>
</body>
</html>
`;
}
