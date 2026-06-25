import { SurfaceProvider } from "@/lib/surface";
import { createRoot } from "react-dom/client";
// The side panel reuses the popup UI verbatim. The only behavioral difference —
// not self-dismissing after actions — is driven by the surface context.
import App from "../popup/App";
import "@/assets/app.css";

// biome-ignore lint/style/noNonNullAssertion: root element is always present in the bundled HTML
const root = document.getElementById("root")!;
createRoot(root).render(
  <SurfaceProvider surface="sidepanel">
    <App />
  </SurfaceProvider>
);
