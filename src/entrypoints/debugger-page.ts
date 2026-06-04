import { installDebuggerPageRuntime } from "@/vendor/capture-core/debugger/engine/page";

export default defineUnlistedScript(() => {
  const win = window as Window & { __recorderCaptureConfig?: { fullSelectorPath?: boolean } };
  installDebuggerPageRuntime({
    fullSelectorPath: win.__recorderCaptureConfig?.fullSelectorPath ?? true,
  });
});
