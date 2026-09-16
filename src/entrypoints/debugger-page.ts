import { installDebuggerPageRuntime } from "@/capture-core/debugger/engine/page";

export default defineUnlistedScript(() => {
  const win = window as Window & {
    __recorderCaptureConfig?: {
      fullSelectorPath?: boolean;
      performance?: boolean;
      network?: {
        exclusionPatterns?: string[];
        captureRequestBodies?: boolean;
        captureXhrFetchResponseBodies?: boolean;
        customRedactedHeaders?: string[];
      };
    };
  };
  installDebuggerPageRuntime({
    fullSelectorPath: win.__recorderCaptureConfig?.fullSelectorPath ?? true,
    performance: win.__recorderCaptureConfig?.performance ?? false,
    network: win.__recorderCaptureConfig?.network,
  });
});
