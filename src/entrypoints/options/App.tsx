import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { sendToBackground } from "@/lib/messaging";
import {
  type CaptureConfig,
  DEFAULT_CAPTURE_CONFIG,
  DEFAULT_NETWORK_FILTER,
  type NetworkFilterConfig,
} from "@/lib/types";
import { useEffect, useState } from "react";

export default function App() {
  const [captureConfig, setCaptureConfig] = useState<CaptureConfig>(DEFAULT_CAPTURE_CONFIG);
  const [networkFilter, setNetworkFilter] = useState<NetworkFilterConfig>(DEFAULT_NETWORK_FILTER);
  const [exclusionText, setExclusionText] = useState("");
  const [customHeadersText, setCustomHeadersText] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sendToBackground<{ captureConfig: CaptureConfig; networkFilter: NetworkFilterConfig }>({
      type: "get-settings",
    })
      .then(({ captureConfig: cc, networkFilter: nf }) => {
        setCaptureConfig(cc);
        setNetworkFilter(nf);
        setExclusionText(nf.exclusionPatterns.join("\n"));
        setCustomHeadersText(nf.customRedactedHeaders.join("\n"));
      })
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
      await sendToBackground({ type: "save-settings", captureConfig, networkFilter: finalFilter });
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
                <Label htmlFor="opt-console" className="font-medium">
                  Console logs
                </Label>
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
                <Label htmlFor="opt-network" className="font-medium">
                  Network requests
                </Label>
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
                <Label htmlFor="opt-interactions" className="font-medium">
                  User interactions
                </Label>
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
                <Label htmlFor="opt-dom" className="font-medium">
                  DOM snapshots
                </Label>
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
                <Label htmlFor="opt-selector-path" className="font-medium">
                  Full selector path
                </Label>
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
                <Label htmlFor="opt-auto-screenshot" className="font-medium">
                  Auto-screenshot on interaction
                </Label>
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
                <Label htmlFor="opt-auto-dom" className="font-medium">
                  Auto-DOM snapshot on interaction
                </Label>
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
              <Label className="font-medium mb-2 block">Capture mode</Label>
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
              <Label htmlFor="exclusion-patterns" className="font-medium mb-1 block">
                URL exclusion patterns
              </Label>
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
                <Label htmlFor="opt-req-bodies" className="font-medium">
                  Request bodies
                </Label>
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
                <Label htmlFor="opt-res-xhr" className="font-medium">
                  XHR + fetch response bodies
                </Label>
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
                <Label htmlFor="opt-res-other" className="font-medium">
                  Other response bodies
                </Label>
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

        <section className="mb-8">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Header redaction
          </h2>
          <Separator className="mb-4" />

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="opt-redact-auth" className="font-medium">
                Redact Authorization header
              </Label>
              <Switch
                id="opt-redact-auth"
                checked={networkFilter.redactAuthHeader}
                onChange={() => toggleNetwork("redactAuthHeader")}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="opt-redact-cookie" className="font-medium">
                Redact Cookie header
              </Label>
              <Switch
                id="opt-redact-cookie"
                checked={networkFilter.redactCookieHeader}
                onChange={() => toggleNetwork("redactCookieHeader")}
              />
            </div>

            <div>
              <Label htmlFor="custom-headers" className="font-medium mb-1 block">
                Custom headers to redact
              </Label>
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
      </div>

      {/* Sticky save footer */}
      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-border bg-background">
        <div className="mx-auto max-w-2xl px-6 py-3 flex items-center justify-end gap-3">
          {isDirty && !saved && (
            <span className="text-sm text-muted-foreground">Unsaved changes</span>
          )}
          {saved && <span className="text-sm text-green-600">Saved</span>}
          {error && <span className="text-sm text-destructive">{error}</span>}
          <Button onClick={save}>Save settings</Button>
        </div>
      </div>
    </div>
  );
}
