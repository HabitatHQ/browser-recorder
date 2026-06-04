import { setupDebuggerContentBridge } from "@/lib/bug-report-debugger/content";

export default defineUnlistedScript(() => {
  setupDebuggerContentBridge();
});
