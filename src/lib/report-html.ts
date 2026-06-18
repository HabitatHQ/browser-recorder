// Builds a single self-contained HTML report that a reviewer can open with no
// server, no extension, and no network. It merges every capture channel into
// one filterable timeline, leads with a "Problems" panel, and links to the
// other artifacts (screenshots, DOM snapshots, video, replay) by relative path
// — so it works as soon as the ZIP is unzipped. The event data is inlined as
// JSON; images/video/dom are referenced rather than embedded to keep it light.
import type { PerformanceSummary, TimelineEntry } from "@browser-recorder/core";

export interface ReportHtmlInput {
  title: string;
  url: string | null;
  durationMs: number | null;
  recordedIso: string;
  device: { browser: string; os: string; viewport: { width: number; height: number } };
  timeline: TimelineEntry[];
  /** Performance scorecard data, or null when perf capture was off/empty. */
  performance: PerformanceSummary | null;
  /** Relative filenames within the ZIP. */
  screenshots: string[];
  domSnapshots: string[];
  video: string | null;
  replay: string | null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON never contains a literal `<`, so escaping it keeps inlined page markup
 * from terminating the <script>. */
function inlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildReportHtml(input: ReportHtmlInput): string {
  const safeTitle = escapeHtml(input.title || "Bug report");
  const data = {
    title: input.title || "Bug report",
    url: input.url,
    durationMs: input.durationMs,
    recordedIso: input.recordedIso,
    device: input.device,
    timeline: input.timeline,
    performance: input.performance,
    screenshots: input.screenshots,
    domSnapshots: input.domSnapshots,
    video: input.video,
    replay: input.replay,
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Report — ${safeTitle}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #14161b; color: #e6e8ec; font: 14px/1.5 system-ui, -apple-system, sans-serif; }
  a { color: #7aa2f7; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 16px 80px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .05em; color: #9aa0aa; margin: 28px 0 10px; }
  .meta { color: #9aa0aa; font-size: 13px; }
  .meta code { color: #cdd2da; }
  .panel { background: #1b1e26; border: 1px solid #2a2e3a; border-radius: 10px; padding: 14px 16px; }
  .problems { border-color: #5a2a2a; }
  .problems.none { border-color: #2a4a2a; }
  .problem { display: flex; gap: 8px; padding: 4px 0; font-size: 13px; }
  .problem a { text-decoration: none; }
  .controls { position: sticky; top: 0; background: #14161bdd; backdrop-filter: blur(6px); padding: 10px 0; display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; z-index: 5; border-bottom: 1px solid #2a2e3a; }
  .controls label { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: #c2c7d0; cursor: pointer; }
  .controls input[type=search] { flex: 1; min-width: 160px; background: #1b1e26; border: 1px solid #2a2e3a; color: #e6e8ec; border-radius: 6px; padding: 6px 10px; }
  .row { display: grid; grid-template-columns: 64px 78px 1fr; gap: 10px; padding: 6px 8px; border-bottom: 1px solid #20242e; align-items: start; }
  .row:target { background: #2a2f3d; border-radius: 6px; }
  .row .off { color: #6f7682; font-variant-numeric: tabular-nums; font-size: 12px; padding-top: 1px; }
  .badge { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; padding: 1px 6px; border-radius: 5px; text-align: center; align-self: start; }
  .b-console { background: #2c313d; color: #aab1bd; }
  .b-network { background: #243044; color: #8fb6f0; }
  .b-action { background: #2e2940; color: #c3a8f0; }
  .b-websocket { background: #1f3a34; color: #7fd1bd; }
  .b-sse { background: #3a2f1f; color: #d8b67f; }
  .b-performance { background: #1f3326; color: #8fd99f; }
  .scores { display: flex; flex-wrap: wrap; gap: 10px; }
  .score { background: #1b1e26; border: 1px solid #2a2e3a; border-radius: 8px; padding: 8px 12px; min-width: 88px; }
  .score .k { font-size: 11px; color: #9aa0aa; text-transform: uppercase; letter-spacing: .04em; }
  .score .v { font-size: 18px; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .score.good .v { color: #7fd1a0; }
  .score.needs-improvement .v { color: #e0c074; }
  .score.poor .v { color: #f08b8b; }
  .perf-tables { display: flex; flex-wrap: wrap; gap: 28px; margin-top: 14px; }
  .perf-tables h3 { font-size: 12px; color: #9aa0aa; margin: 0 0 6px; font-weight: 600; }
  .perf-tables table { border-collapse: collapse; font-size: 12px; }
  .perf-tables td { padding: 2px 14px 2px 0; font-variant-numeric: tabular-nums; vertical-align: top; }
  .perf-tables td.name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lvl-error { color: #f08b8b; }
  .lvl-warn { color: #e0c074; }
  .summary { min-width: 0; }
  .summary .main { word-break: break-word; }
  .summary .sub { color: #8990a0; font-size: 12px; margin-top: 2px; }
  .from { color: #c3a8f0; font-size: 11px; }
  .fail { color: #f08b8b; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  details > summary { cursor: pointer; color: #8990a0; font-size: 12px; }
  pre { white-space: pre-wrap; word-break: break-word; background: #11131a; border: 1px solid #20242e; border-radius: 6px; padding: 8px; margin: 6px 0 0; font-size: 12px; max-height: 320px; overflow: auto; }
  .shots { display: flex; flex-wrap: wrap; gap: 10px; }
  .shots a img { height: 120px; width: auto; border: 1px solid #2a2e3a; border-radius: 6px; display: block; }
  .links a { display: inline-block; margin: 0 12px 6px 0; }
  .hidden { display: none !important; }
  .empty { color: #6f7682; padding: 16px 0; }
</style>
</head>
<body>
<div class="wrap">
  <h1 id="title"></h1>
  <div class="meta" id="meta"></div>

  <div id="problemsWrap"></div>

  <div id="perfWrap"></div>

  <h2>Timeline</h2>
  <div class="controls" id="controls">
    <label><input type="checkbox" data-kind="console" checked> Console</label>
    <label><input type="checkbox" data-kind="network" checked> Network</label>
    <label><input type="checkbox" data-kind="action" checked> Interactions</label>
    <label><input type="checkbox" data-kind="websocket" checked> WebSocket</label>
    <label><input type="checkbox" data-kind="sse" checked> SSE</label>
    <label><input type="checkbox" data-kind="performance" checked> Performance</label>
    <label><input type="checkbox" id="errorsOnly"> Errors only</label>
    <input type="search" id="search" placeholder="Filter text…" />
  </div>
  <div id="timeline"></div>

  <div id="shotsWrap"></div>
  <div id="attachWrap"></div>
</div>

<script>window.__report = ${inlineJson(data)};</script>
<script>
(function () {
  var R = window.__report;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function fmtOff(ms) {
    if (ms == null) return "—";
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return "+" + String(m).padStart(2,"0") + ":" + String(s % 60).padStart(2,"0");
  }
  function fmtDur(ms) {
    if (ms == null) return "?";
    var s = Math.floor(ms/1000), m = Math.floor(s/60);
    return m > 0 ? m + "m " + (s%60) + "s" : s + "s";
  }
  function fmtMs(ms) {
    if (ms == null) return "—";
    return ms < 1000 ? Math.round(ms) + " ms" : (ms / 1000).toFixed(2) + " s";
  }
  function fmtBytes(b) {
    if (b == null) return "—";
    return b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.round(b / 1024) + " KB";
  }
  function fmtVital(v) { return v.unit === "score" ? Number(v.value).toFixed(3) : fmtMs(v.value); }
  // One-line label for a performance event on the timeline.
  function perfLabel(e) {
    if (e.metric === "web-vital") return e.name + " " + fmtVital({ unit: e.unit, value: e.value }) + (e.rating ? " (" + e.rating + ")" : "");
    if (e.metric === "long-task") return "long task " + fmtMs(e.value);
    if (e.metric === "resource") return "resource " + fmtMs(e.value) + " · " + e.name;
    if (e.metric === "measure") return "measure " + fmtMs(e.value) + " · " + e.name;
    if (e.metric === "memory") return "heap " + fmtBytes(e.value);
    if (e.metric === "frame") return e.value + " fps";
    return e.name + " " + e.value;
  }

  // Header
  $("title").textContent = R.title;
  var meta = [];
  if (R.url) meta.push('URL: <code>' + esc(R.url) + '</code>');
  meta.push("Duration: " + fmtDur(R.durationMs));
  meta.push("Recorded: " + esc(R.recordedIso));
  if (R.device) meta.push(esc(R.device.os) + " · " + R.device.viewport.width + "×" + R.device.viewport.height);
  $("meta").innerHTML = meta.join(" &nbsp;·&nbsp; ");

  // Per-kind one-line summary + optional detail block.
  function netDetail(e) {
    var d = "";
    if (e.requestHeaders) d += "request headers\\n" + JSON.stringify(e.requestHeaders, null, 2) + "\\n\\n";
    if (e.requestBody) d += "request body\\n" + e.requestBody + "\\n\\n";
    if (e.responseHeaders) d += "response headers\\n" + JSON.stringify(e.responseHeaders, null, 2) + "\\n\\n";
    if (e.responseBody) d += "response body\\n" + e.responseBody + "\\n";
    return d.trim();
  }
  function summarize(entry) {
    var e = entry.event, k = entry.kind, html = "", sub = "", detail = "", text = "";
    if (k === "console") {
      var cls = e.level === "error" ? "lvl-error" : e.level === "warn" ? "lvl-warn" : "";
      html = '<span class="' + cls + ' mono">' + esc(e.message) + '</span>';
      text = e.message;
      if (e.metadata && e.metadata.stack) detail = String(e.metadata.stack);
    } else if (k === "network") {
      var failed = e.status != null && e.status >= 400;
      html = '<span class="mono">' + (e.dropped ? '<span class="fail">[dropped] </span>' : "")
        + '<b class="' + (failed ? "fail" : "") + '">' + (e.status == null ? "—" : e.status) + '</b> '
        + esc(e.method) + ' ' + esc(e.url) + (e.duration != null ? ' · ' + e.duration + 'ms' : '') + '</span>';
      text = e.method + " " + e.url + " " + (e.status || "");
      if (!e.dropped) detail = netDetail(e);
    } else if (k === "action") {
      var m = e.metadata || {};
      var label = m.label || m.text;
      var tgt = e.actionType === "navigation" ? (m.path || m.url || "") : (e.target || "");
      html = '<span class="mono"><b>' + esc(e.actionType) + '</b> ' + esc(label ? '"' + label + '"' : tgt) + '</span>';
      if (label && tgt) sub = esc(tgt);
      if (m.valueLength != null) sub = (sub ? sub + " · " : "") + m.valueLength + " chars";
      text = e.actionType + " " + (label || "") + " " + tgt;
    } else if (k === "websocket") {
      var dir = e.event === "send" ? "↑" : e.event === "message" ? "↓" : e.event;
      html = '<span class="mono">' + esc(dir) + ' ' + esc(e.data || e.url) + '</span>';
      text = e.event + " " + (e.data || e.url);
    } else if (k === "sse") {
      html = '<span class="mono">' + esc(e.eventType || e.event) + ' ' + esc(e.data || e.url) + '</span>';
      text = (e.eventType || e.event) + " " + (e.data || e.url);
    } else if (k === "performance") {
      var poor = e.rating === "poor" || (e.metric === "long-task" && e.value >= 100);
      html = '<span class="mono ' + (poor ? "lvl-warn" : "") + '">' + esc(perfLabel(e)) + '</span>';
      text = e.metric + " " + e.name + " " + e.value;
    }
    return { html: html, sub: sub, detail: detail, text: text.toLowerCase() };
  }

  // Build rows once; filtering toggles a .hidden class.
  var tl = $("timeline");
  var rows = R.timeline.map(function (entry) {
    var s = summarize(entry);
    var row = document.createElement("div");
    row.className = "row";
    row.id = "e" + entry.seq;
    row.dataset.kind = entry.kind;
    row.dataset.text = s.text;
    row.dataset.error = (entry.kind === "console" && entry.event.level === "error")
      || (entry.kind === "network" && entry.event.status != null && entry.event.status >= 400) ? "1" : "0";
    var from = entry.initiatedBySeq ? ' <a class="from" href="#e' + entry.initiatedBySeq + '">↳ from #' + entry.initiatedBySeq + '</a>' : "";
    var detail = s.detail ? '<details><summary>details</summary><pre>' + esc(s.detail) + '</pre></details>' : "";
    row.innerHTML =
      '<div class="off">' + fmtOff(entry.offsetMs) + '</div>' +
      '<div class="badge b-' + entry.kind + '">' + (entry.kind === "action" ? "interact" : entry.kind === "performance" ? "perf" : entry.kind) + '</div>' +
      '<div class="summary"><div class="main">' + s.html + from + '</div>' +
      (s.sub ? '<div class="sub mono">' + s.sub + '</div>' : "") + detail + '</div>';
    tl.appendChild(row);
    return row;
  });
  if (rows.length === 0) tl.innerHTML = '<div class="empty">No timeline events were captured.</div>';

  function applyFilters() {
    var kinds = {};
    document.querySelectorAll("#controls input[data-kind]").forEach(function (c) { kinds[c.dataset.kind] = c.checked; });
    var errorsOnly = $("errorsOnly").checked;
    var q = $("search").value.trim().toLowerCase();
    rows.forEach(function (row) {
      var ok = kinds[row.dataset.kind]
        && (!errorsOnly || row.dataset.error === "1")
        && (!q || row.dataset.text.indexOf(q) !== -1);
      row.classList.toggle("hidden", !ok);
    });
  }
  $("controls").addEventListener("input", applyFilters);

  // Problems panel
  var problems = [];
  R.timeline.forEach(function (entry) {
    var e = entry.event;
    if (entry.kind === "console" && e.level === "error") {
      var unc = e.message.indexOf("[uncaught]") === 0 || e.message.indexOf("[unhandled rejection]") === 0;
      problems.push({ seq: entry.seq, off: entry.offsetMs, text: (unc ? "uncaught: " : "console error: ") + e.message });
    } else if (entry.kind === "network" && e.status != null && e.status >= 400) {
      problems.push({ seq: entry.seq, off: entry.offsetMs, text: e.status + " " + e.method + " " + e.url });
    }
  });
  var pw = $("problemsWrap");
  if (problems.length) {
    pw.innerHTML = '<h2>Problems (' + problems.length + ')</h2><div class="panel problems">' +
      problems.map(function (p) {
        return '<div class="problem"><span class="off">' + fmtOff(p.off) + '</span>' +
          '<a href="#e' + p.seq + '" class="mono fail">' + esc(p.text.slice(0, 200)) + '</a></div>';
      }).join("") + '</div>';
  } else {
    pw.innerHTML = '<h2>Problems</h2><div class="panel problems none">No errors or failed requests were captured.</div>';
  }

  // Performance scorecard
  var perf = R.performance;
  if (perf) {
    var cards = (perf.vitals || []).map(function (v) {
      return '<div class="score ' + (v.rating || "") + '"><div class="k">' + esc(v.name) +
        '</div><div class="v">' + esc(fmtVital(v)) + '</div></div>';
    });
    if (perf.navigation && perf.navigation.loadMs != null)
      cards.push('<div class="score"><div class="k">Load</div><div class="v">' + esc(fmtMs(perf.navigation.loadMs)) + '</div></div>');
    if (perf.peakHeapBytes != null)
      cards.push('<div class="score"><div class="k">Peak heap</div><div class="v">' + esc(fmtBytes(perf.peakHeapBytes)) + '</div></div>');

    var tables = [];
    if (perf.longTasks && perf.longTasks.length) {
      tables.push('<div><h3>Longest tasks (' + perf.totals.longTasks + ')</h3><table><tbody>' +
        perf.longTasks.map(function (t) { return '<tr><td>' + esc(fmtMs(t.durationMs)) + '</td></tr>'; }).join("") +
        '</tbody></table></div>');
    }
    if (perf.slowestResources && perf.slowestResources.length) {
      tables.push('<div><h3>Slowest resources (' + perf.totals.resources + ')</h3><table><tbody>' +
        perf.slowestResources.map(function (r) {
          return '<tr><td>' + esc(fmtMs(r.durationMs)) + '</td><td class="name">' + esc(r.name) + '</td></tr>';
        }).join("") + '</tbody></table></div>');
    }

    if (cards.length || tables.length) {
      $("perfWrap").innerHTML = '<h2>Performance</h2><div class="panel">' +
        (cards.length ? '<div class="scores">' + cards.join("") + '</div>' : "") +
        (tables.length ? '<div class="perf-tables">' + tables.join("") + '</div>' : "") + '</div>';
    }
  }

  // Screenshots
  if (R.screenshots && R.screenshots.length) {
    $("shotsWrap").innerHTML = '<h2>Screenshots</h2><div class="shots">' +
      R.screenshots.map(function (f) { return '<a href="' + esc(f) + '" target="_blank"><img src="' + esc(f) + '" alt="' + esc(f) + '"></a>'; }).join("") + '</div>';
  }

  // Attachments
  var links = [];
  (R.domSnapshots || []).forEach(function (f) { links.push('<a href="' + esc(f) + '" target="_blank">' + esc(f) + '</a>'); });
  if (R.video) links.push('<a href="' + esc(R.video) + '" target="_blank">video</a>');
  if (R.replay) links.push('<a href="' + esc(R.replay) + '" target="_blank">session replay</a>');
  if (links.length) $("attachWrap").innerHTML = '<h2>Attachments</h2><div class="links">' + links.join("") + '</div>';
})();
</script>
</body>
</html>
`;
}
