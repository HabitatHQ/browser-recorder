// Builds a single self-contained HTML file that replays an rrweb session with
// no extension and no network. We inline rrweb's UMD bundle + stylesheet and
// drive its Replayer directly with a small vanilla control bar. (rrweb-player
// 2.0.1 is a Svelte 5 component that renders blank under `new Player()`, so we
// avoid it and use the same Replayer the in-extension preview uses.)
//
// Imported by relative path because rrweb's `exports` map doesn't expose the
// UMD/min file as a subpath.
import rrwebJs from "../../node_modules/rrweb/dist/rrweb.umd.min.cjs?raw";
import rrwebCss from "../../node_modules/rrweb/dist/style.css?raw";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * JSON structural chars never include `<`, so escaping `<` to `<` (valid
 * inside JSON strings) prevents a captured page's markup from terminating the
 * inline <script>.
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
<style>${rrwebCss}</style>
<style>
  html, body { margin: 0; background: #16181d; color: #e6e6e6; font: 14px system-ui, sans-serif; }
  .wrap { display: flex; flex-direction: column; gap: 12px; padding: 16px; max-width: 1280px; margin: 0 auto; }
  #box { width: 100%; background: #fff; border-radius: 8px; overflow: hidden; }
  .controls { display: flex; align-items: center; gap: 12px; }
  .controls button { background: #2a2d36; color: #e6e6e6; border: 1px solid #3a3d46; border-radius: 6px; padding: 6px 14px; cursor: pointer; }
  .controls input[type=range] { flex: 1; }
  .hint { color: #9aa0aa; }
</style>
</head>
<body>
<div class="wrap">
  <div id="box"></div>
  <div class="controls" id="controls" hidden>
    <button id="pp" type="button">Play</button>
    <input id="seek" type="range" min="0" value="0" />
    <span id="t" class="hint"></span>
  </div>
  <div id="empty" class="hint" hidden>No replay data was captured for this session.</div>
</div>
<script>${rrwebJs}</script>
<script>window.__replayEvents = ${inlineEventsJson(events)};</script>
<script>
(function () {
  var events = window.__replayEvents || [];
  var box = document.getElementById("box");
  if (events.length < 2 || typeof rrweb === "undefined" || !rrweb.Replayer) {
    document.getElementById("empty").hidden = false;
    return;
  }
  var replayer = new rrweb.Replayer(events, { root: box, showWarning: false, mouseTail: false });
  var total = replayer.getMetaData().totalTime;
  var metaEvent = events.find(function (e) { return e && e.type === 4; });
  var recW = (metaEvent && metaEvent.data && metaEvent.data.width) || box.clientWidth || 1280;
  var recH = (metaEvent && metaEvent.data && metaEvent.data.height) || 720;
  var scale = Math.min(1, box.clientWidth / recW);
  var wrapper = box.querySelector(".replayer-wrapper");
  if (wrapper) { wrapper.style.transform = "scale(" + scale + ")"; wrapper.style.transformOrigin = "top left"; }
  box.style.height = Math.ceil(recH * scale) + "px";
  replayer.pause(0);

  var controls = document.getElementById("controls");
  controls.hidden = false;
  var btn = document.getElementById("pp");
  var seek = document.getElementById("seek");
  var label = document.getElementById("t");
  seek.max = total;
  var playing = false, raf = 0;
  function fmt(ms) { return (ms / 1000).toFixed(1) + "s"; }
  function render(c) { label.textContent = fmt(c) + " / " + fmt(total); }
  render(0);
  function loop() {
    var c = Math.min(replayer.getCurrentTime(), total);
    seek.value = c; render(c);
    raf = requestAnimationFrame(loop);
  }
  function play() {
    var c = Number(seek.value);
    replayer.play(c >= total ? 0 : c);
    playing = true; btn.textContent = "Pause"; raf = requestAnimationFrame(loop);
  }
  function pause() {
    replayer.pause(); playing = false; btn.textContent = "Play"; cancelAnimationFrame(raf);
  }
  btn.onclick = function () { playing ? pause() : play(); };
  seek.oninput = function () {
    var t = Number(seek.value);
    if (playing) replayer.play(t); else replayer.pause(t);
    render(t);
  };
  replayer.on("finish", function () { playing = false; btn.textContent = "Play"; cancelAnimationFrame(raf); });
})();
</script>
</body>
</html>
`;
}
