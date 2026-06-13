// Vite's `?raw` imports return the file contents as a string. WXT bundles Vite
// but doesn't expose `vite/client` types in this pnpm layout, so declare the
// suffix ourselves. Used to inline the rrweb-player bundle into replay.html.
declare module "*?raw" {
  const content: string;
  export default content;
}
