import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildReplayHtml } from "./replay-html";

const RUNTIME = "window.rrweb={Replayer:function ReplayRuntimeMarker(){}};";

describe("buildReplayHtml", () => {
  it("embeds the supplied local runtime before replay data", () => {
    const html = buildReplayHtml([{ type: 4, timestamp: 1, data: {} }], "Local replay", RUNTIME);

    expect(html).toContain(RUNTIME);
    expect(html.indexOf(RUNTIME)).toBeLessThan(html.indexOf("window.__replayEvents"));
  });

  it("keeps arbitrary replay JSON from terminating its script", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const html = buildReplayHtml([value], "Replay", RUNTIME);
        const replayData = html.slice(
          html.indexOf("window.__replayEvents"),
          html.indexOf("</script>", html.indexOf("window.__replayEvents"))
        );

        expect(replayData.toLowerCase()).not.toContain("</script");
      })
    );
  });
});
