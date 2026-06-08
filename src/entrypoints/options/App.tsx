import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { sendToBackground } from "@/lib/messaging";
import {
  type CaptureConfig,
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_NETWORK_FILTER,
  DEFAULT_RING_CONFIG,
  DEFAULT_VIDEO_CONFIG,
  type NetworkFilterConfig,
  type RingConfig,
  type VideoConfig,
  type VideoFormat,
} from "@/lib/types";
import { useEffect, useMemo, useState } from "react";

// Maps each explicit format to its probe MIME type
const FORMAT_MIME: Record<Exclude<VideoFormat, "auto">, string> = {
  vp9: "video/webm;codecs=vp9",
  vp8: "video/webm;codecs=vp8",
  av1: "video/webm;codecs=av1",
  h264: "video/mp4;codecs=avc1",
};

const FORMAT_LABELS: Record<VideoFormat, string> = {
  auto: "Auto (VP9)",
  vp9: "VP9 — WebM",
  vp8: "VP8 — WebM (faster encode)",
  av1: "AV1 — WebM (smaller, slow encode)",
  h264: "H.264 — MP4",
};

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex items-center">
      <span className="flex h-3.5 w-3.5 cursor-default select-none items-center justify-center rounded-full border border-muted-foreground/40 text-[9px] font-semibold text-muted-foreground">
        ?
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-md bg-neutral-800 px-3 py-2 text-xs leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
        {text}
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-neutral-800" />
      </span>
    </span>
  );
}

export default function App() {
  const [captureConfig, setCaptureConfig] = useState<CaptureConfig>(DEFAULT_CAPTURE_CONFIG);
  const [networkFilter, setNetworkFilter] = useState<NetworkFilterConfig>(DEFAULT_NETWORK_FILTER);
  const [videoConfig, setVideoConfig] = useState<VideoConfig>(DEFAULT_VIDEO_CONFIG);
  const [ringConfig, setRingConfig] = useState<RingConfig>(DEFAULT_RING_CONFIG);
  const [exclusionText, setExclusionText] = useState("");
  const [customHeadersText, setCustomHeadersText] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Formats supported by MediaRecorder in this browser context
  const supportedFormats = useMemo<VideoFormat[]>(() => {
    if (typeof MediaRecorder === "undefined") return ["auto"];
    return (["auto", "vp9", "vp8", "av1", "h264"] as VideoFormat[]).filter((f) => {
      if (f === "auto") return true;
      return MediaRecorder.isTypeSupported(FORMAT_MIME[f]);
    });
  }, []);

  useEffect(() => {
    sendToBackground<{
      captureConfig: CaptureConfig;
      networkFilter: NetworkFilterConfig;
      videoConfig: VideoConfig;
    }>({ type: "get-settings" })
      .then(({ captureConfig: cc, networkFilter: nf, videoConfig: vc }) => {
        setCaptureConfig(cc);
        setNetworkFilter(nf);
        setVideoConfig(vc);
        setExclusionText(nf.exclusionPatterns.join("\n"));
        setCustomHeadersText(nf.customRedactedHeaders.join("\n"));
      })
      .catch(() => {});
    sendToBackground<RingConfig>({ type: "get-ring-config" })
      .then((rc) => setRingConfig(rc))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  const toggleCapture = (key: keyof CaptureConfig) => {
    setCaptureConfig((c) => ({ ...c, [key]: !c[key] }));
    setIsDirty(true);
  };

  const toggleNetwork = (key: keyof NetworkFilterConfig) => {
    setNetworkFilter((n) => ({ ...n, [key]: !n[key as keyof typeof n] }));
    setIsDirty(true);
  };

  const save = async () => {
    try {
      setError(null);
      const patterns = exclusionText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const customHeaders = customHeadersText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const finalFilter: NetworkFilterConfig = {
        ...networkFilter,
        exclusionPatterns: patterns,
        customRedactedHeaders: customHeaders,
      };
      await sendToBackground({
        type: "save-settings",
        captureConfig,
        networkFilter: finalFilter,
        videoConfig,
      });
      await sendToBackground({ type: "save-ring-config", ringConfig });
      setSaved(true);
      setIsDirty(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="bg-background text-foreground min-h-screen pb-20">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <h1 className="text-xl font-semibold mb-6">Chrome Recorder — Settings</h1>

        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Capture defaults
          </h2>
          <Separator className="mb-4" />

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="opt-console" className="font-medium">
                    Console logs
                  </Label>
                  <InfoTooltip text="Intercepts console.log, .warn, .error, .info, and .debug. Each entry is recorded with the log level, message text, and a timestamp relative to session start." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Capture console.log / warn / error / info
                </p>
              </div>
              <Switch
                id="opt-console"
                checked={captureConfig.console}
                onChange={() => toggleCapture("console")}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="opt-network" className="font-medium">
                    Network requests
                  </Label>
                  <InfoTooltip text="Captures XHR and fetch calls including URL, method, HTTP status, headers, and bodies (truncated to 10 kB each). Configure which requests to capture and which to exclude in the Network filter section below." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  XHR and fetch calls (configurable below)
                </p>
              </div>
              <Switch
                id="opt-network"
                checked={captureConfig.network}
                onChange={() => toggleCapture("network")}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="opt-interactions" className="font-medium">
                    User interactions
                  </Label>
                  <InfoTooltip text="Records clicks, text input, form changes, and navigations. Input values are stored as character counts only — raw text is never captured. Password fields are skipped entirely." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Clicks, inputs, navigations</p>
              </div>
              <Switch
                id="opt-interactions"
                checked={captureConfig.interactions}
                onChange={() => toggleCapture("interactions")}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="opt-dom" className="font-medium">
                    DOM snapshots
                  </Label>
                  <InfoTooltip text="Saves a full copy of the page HTML at session start and on demand. Relative URLs are resolved and same-origin stylesheets are inlined. Large SPAs can produce 5–10 MB per snapshot." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  HTML snapshot at session start + on demand
                </p>
              </div>
              <Switch
                id="opt-dom"
                checked={captureConfig.domSnapshots}
                onChange={() => toggleCapture("domSnapshots")}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="opt-selector-path" className="font-medium">
                    Full selector path
                  </Label>
                  <InfoTooltip text="When on, interaction targets are described as CSS paths like form > label > input. When off, only the clicked element itself is logged. The full path is more debuggable but more verbose." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Walk up the DOM to build a path like <code>form &gt; div &gt; button</code>.
                  Disable for just the element itself.
                </p>
              </div>
              <Switch
                id="opt-selector-path"
                checked={captureConfig.fullSelectorPath}
                onChange={() => toggleCapture("fullSelectorPath")}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="opt-auto-screenshot" className="font-medium">
                    Auto-screenshot on interaction
                  </Label>
                  <InfoTooltip text="Takes a screenshot 1.5 s after each click, input change, or navigation, debounced so rapid actions produce one screenshot. Can generate many screenshots on busy workflows — check the count in the recorder before exporting." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Take a screenshot 1.5 s after each click, change, or navigation. Debounced.
                </p>
              </div>
              <Switch
                id="opt-auto-screenshot"
                checked={captureConfig.autoScreenshotOnInteraction}
                onChange={() => toggleCapture("autoScreenshotOnInteraction")}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="opt-auto-dom" className="font-medium">
                    Auto-DOM snapshot on interaction
                  </Label>
                  <InfoTooltip text="Captures a DOM snapshot 1.5 s after each click, input change, or navigation. Each snapshot can be 5–10 MB on complex pages. Disable if your exports are unexpectedly large." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Capture a DOM snapshot 1.5 s after each click, change, or navigation. Debounced.
                </p>
              </div>
              <Switch
                id="opt-auto-dom"
                checked={captureConfig.autoDomSnapshotOnInteraction}
                onChange={() => toggleCapture("autoDomSnapshotOnInteraction")}
              />
            </div>
          </div>
        </section>

        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Network filter
          </h2>
          <Separator className="mb-4" />

          <div className="flex flex-col gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Label className="font-medium">Capture mode</Label>
                <InfoTooltip text="XHR + fetch only captures API calls and is almost always sufficient. All resources also includes scripts, stylesheets, fonts, and images — useful for diagnosing resource loading failures but generates 10–100× more entries." />
              </div>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="radio"
                    name="capture-mode"
                    value="xhr-fetch"
                    checked={networkFilter.mode === "xhr-fetch"}
                    onChange={() => {
                      setNetworkFilter((n) => ({ ...n, mode: "xhr-fetch" }));
                      setIsDirty(true);
                    }}
                    className="accent-primary"
                  />
                  XHR + fetch only
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="radio"
                    name="capture-mode"
                    value="all"
                    checked={networkFilter.mode === "all"}
                    onChange={() => {
                      setNetworkFilter((n) => ({ ...n, mode: "all" }));
                      setIsDirty(true);
                    }}
                    className="accent-primary"
                  />
                  All resources{" "}
                  <span className="text-muted-foreground">
                    (includes static assets — can generate 500+ requests per page load)
                  </span>
                </label>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Label htmlFor="exclusion-patterns" className="font-medium">
                  URL exclusion patterns
                </Label>
                <InfoTooltip text="Glob patterns matched against the full request URL. Matching requests are silently dropped from the capture. Useful for filtering out analytics pings, health checks, or other noise. Supports * as a wildcard." />
              </div>
              <Textarea
                id="exclusion-patterns"
                placeholder={"/analytics/*\n*/health\napi.example.com/track"}
                value={exclusionText}
                onChange={(e) => {
                  setExclusionText(e.target.value);
                  setIsDirty(true);
                }}
                rows={3}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">
                One glob pattern per line. Matching requests are excluded.
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="opt-req-bodies" className="font-medium">
                    Request bodies
                  </Label>
                  <InfoTooltip text="Captures the payload for POST, PUT, and PATCH requests. Truncated to 10 kB. May contain sensitive data — disable if the app sends credentials or PII in request bodies." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Truncated at 10 kB</p>
              </div>
              <Switch
                id="opt-req-bodies"
                checked={networkFilter.captureRequestBodies}
                onChange={() => toggleNetwork("captureRequestBodies")}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="opt-res-xhr" className="font-medium">
                    XHR + fetch response bodies
                  </Label>
                  <InfoTooltip text="Captures the response payload for XHR and fetch calls. Truncated to 10 kB. Useful for seeing what the server returned, but increases export size. Off by default." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Truncated at 10 kB</p>
              </div>
              <Switch
                id="opt-res-xhr"
                checked={networkFilter.captureXhrFetchResponseBodies}
                onChange={() => toggleNetwork("captureXhrFetchResponseBodies")}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="opt-res-other" className="font-medium">
                    Other response bodies
                  </Label>
                  <InfoTooltip text="Captures response bodies for scripts, stylesheets, fonts, and images. Almost never needed and can make exports very large. Only enable this if you're diagnosing a specific resource loading issue." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Scripts, stylesheets, images — high volume
                </p>
              </div>
              <Switch
                id="opt-res-other"
                checked={networkFilter.captureOtherResponseBodies}
                onChange={() => toggleNetwork("captureOtherResponseBodies")}
              />
            </div>
          </div>
        </section>

        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Header redaction
          </h2>
          <Separator className="mb-4" />

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="opt-redact-auth" className="font-medium">
                  Redact Authorization header
                </Label>
                <InfoTooltip text="Replaces the Authorization header value with [REDACTED] in captured network data. Keeps Bearer tokens, Basic credentials, and API keys out of exported reports. On by default." />
              </div>
              <Switch
                id="opt-redact-auth"
                checked={networkFilter.redactAuthHeader}
                onChange={() => toggleNetwork("redactAuthHeader")}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="opt-redact-cookie" className="font-medium">
                  Redact Cookie header
                </Label>
                <InfoTooltip text="Replaces the Cookie header value with [REDACTED]. Session cookies and auth tokens are especially sensitive. On by default." />
              </div>
              <Switch
                id="opt-redact-cookie"
                checked={networkFilter.redactCookieHeader}
                onChange={() => toggleNetwork("redactCookieHeader")}
              />
            </div>

            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Label htmlFor="custom-headers" className="font-medium">
                  Custom headers to redact
                </Label>
                <InfoTooltip text="Additional request headers to redact beyond Authorization and Cookie. Header names are case-insensitive. Common examples: X-Api-Key, X-Auth-Token, X-Session-Id." />
              </div>
              <Textarea
                id="custom-headers"
                placeholder={"X-Api-Key\nX-Auth-Token"}
                value={customHeadersText}
                onChange={(e) => {
                  setCustomHeadersText(e.target.value);
                  setIsDirty(true);
                }}
                rows={3}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">One header name per line.</p>
            </div>
          </div>
        </section>
        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Export
          </h2>
          <Separator className="mb-4" />

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="opt-zip-nesting" className="font-medium">
                    Nest files in folder
                  </Label>
                  <InfoTooltip text="Places all files inside a named folder within the zip (e.g. browser-recording-example-com-20240101-1200/report.md). Prevents files from scattering into the current directory on extraction. On by default." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Wrap zip contents in a folder to avoid clobbering on extraction
                </p>
              </div>
              <Switch
                id="opt-zip-nesting"
                checked={captureConfig.zipFolderNesting}
                onChange={() => toggleCapture("zipFolderNesting")}
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="opt-title-filename" className="font-medium">
                    Use title as filename
                  </Label>
                  <InfoTooltip text="Names the exported zip after the report title slug (e.g. login-flow-broken.zip) instead of the default browser-recording-<host>-<timestamp>.zip. Off by default." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Off: browser-recording-&lt;host&gt;-&lt;timestamp&gt;.zip
                </p>
              </div>
              <Switch
                id="opt-title-filename"
                checked={captureConfig.zipTitleFilename}
                onChange={() => toggleCapture("zipTitleFilename")}
              />
            </div>
          </div>
        </section>

        <section className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Video recording
          </h2>
          <Separator className="mb-4" />

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <Label className="font-medium">Resolution</Label>
                  <InfoTooltip text="Caps the capture resolution sent to the encoder. 720p significantly reduces CPU usage and file size with little perceptible quality loss for screen recordings. 'Native' passes through whatever resolution the tab is rendered at." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Max capture resolution</p>
              </div>
              <select
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={videoConfig.resolution}
                onChange={(e) => {
                  setVideoConfig((v) => ({
                    ...v,
                    resolution: e.target.value as VideoConfig["resolution"],
                  }));
                  setIsDirty(true);
                }}
              >
                <option value="720p">720p — 1280×720</option>
                <option value="1080p">1080p — 1920×1080</option>
                <option value="native">Native (no cap)</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <Label className="font-medium">Frame rate</Label>
                  <InfoTooltip text="Maximum frames per second captured. 30 fps is more than sufficient for most UI recordings. 15 fps cuts CPU and bitrate roughly in half again." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Max frames per second</p>
              </div>
              <select
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={videoConfig.frameRate}
                onChange={(e) => {
                  setVideoConfig((v) => ({ ...v, frameRate: Number(e.target.value) }));
                  setIsDirty(true);
                }}
              >
                <option value={15}>15 fps</option>
                <option value={24}>24 fps</option>
                <option value={30}>30 fps</option>
                <option value={60}>60 fps</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <Label className="font-medium">Bitrate</Label>
                  <InfoTooltip text="Target encoding bitrate. 1.5 Mbps is the default and produces clear recordings at 720p/30fps. Higher values improve quality for fast-moving content; lower values reduce file size." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Target encoding bitrate</p>
              </div>
              <select
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={videoConfig.bitrate}
                onChange={(e) => {
                  setVideoConfig((v) => ({ ...v, bitrate: Number(e.target.value) }));
                  setIsDirty(true);
                }}
              >
                <option value={500}>500 kbps</option>
                <option value={750}>750 kbps</option>
                <option value={1000}>1 Mbps</option>
                <option value={1500}>1.5 Mbps</option>
                <option value={2000}>2 Mbps</option>
                <option value={3000}>3 Mbps</option>
                <option value={4000}>4 Mbps</option>
              </select>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <Label className="font-medium">Format</Label>
                  <InfoTooltip text="Codec and container. Auto picks VP9/WebM which works everywhere. VP8 encodes faster with slightly larger files. AV1 is more efficient but CPU-intensive. H.264/MP4 is supported on Chrome 130+ and plays natively in most video players." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Only formats supported by this browser are shown
                </p>
              </div>
              <select
                className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={videoConfig.format}
                onChange={(e) => {
                  setVideoConfig((v) => ({
                    ...v,
                    format: e.target.value as VideoConfig["format"],
                  }));
                  setIsDirty(true);
                }}
              >
                {supportedFormats.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Ring recording
          </h2>
          <Separator className="mb-4" />

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="opt-ring-enabled" className="font-medium">
                    Enable ring recording
                  </Label>
                  <InfoTooltip text="Always-on background buffer that silently captures the last N minutes of activity on the active tab. Use 'Export ring' in the popup to snapshot and review the buffer." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Toggle from the popup; this sets the default
                </p>
              </div>
              <Switch
                id="opt-ring-enabled"
                checked={ringConfig.enabled}
                onChange={() => {
                  setRingConfig((r) => ({ ...r, enabled: !r.enabled }));
                  setIsDirty(true);
                }}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <Label htmlFor="opt-ring-data" className="font-medium">
                  Data buffer (minutes)
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Console, network, interactions retention
                </p>
              </div>
              <Input
                id="opt-ring-data"
                type="number"
                min={1}
                max={60}
                className="w-20 text-sm"
                value={Math.round(ringConfig.dataDurationSec / 60)}
                onChange={(e) => {
                  const mins = Math.max(1, Number(e.target.value));
                  setRingConfig((r) => ({ ...r, dataDurationSec: mins * 60 }));
                  setIsDirty(true);
                }}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="opt-ring-video" className="font-medium">
                    Video buffer (minutes)
                  </Label>
                  <InfoTooltip text="Chrome only. Keeps only the last N minutes of ring video in memory. Set to 0 to disable ring video entirely." />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  In-memory only; written to disk on export · Chrome only
                </p>
              </div>
              <Input
                id="opt-ring-video"
                type="number"
                min={0}
                max={30}
                className="w-20 text-sm"
                value={Math.round(ringConfig.videoDurationSec / 60)}
                onChange={(e) => {
                  const mins = Math.max(0, Number(e.target.value));
                  setRingConfig((r) => ({ ...r, videoDurationSec: mins * 60 }));
                  setIsDirty(true);
                }}
              />
            </div>
          </div>
        </section>
      </div>

      {/* Sticky save footer */}
      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-border bg-background">
        <div className="mx-auto max-w-2xl px-6 py-3 flex items-center justify-end gap-3">
          {isDirty && !saved && (
            <span className="text-sm text-muted-foreground">Unsaved changes</span>
          )}
          {saved && <span className="text-sm text-green-600 dark:text-green-400">Saved</span>}
          {error && <span className="text-sm text-destructive">{error}</span>}
          <Button onClick={save}>Save settings</Button>
        </div>
      </div>
    </div>
  );
}
