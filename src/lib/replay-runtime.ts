// The build packages the rrweb UMD bundle at this extension-local path. The
// review UI loads it directly, while exports read the same bytes and inline
// them into the standalone replay document. No network or CDN is involved.
import replayStyles from "../../node_modules/rrweb/dist/style.css?raw";

export const replayRuntimeUrl = "/assets/rrweb-replay.js";
export { replayStyles };
export async function loadReplayRuntimeSource(): Promise<string> {
  const response = await fetch(replayRuntimeUrl);
  if (!response.ok) {
    throw new Error(`Failed to load the packaged replay runtime (${response.status})`);
  }
  return response.text();
}
