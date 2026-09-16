// Vite's `?raw` suffix returns file contents. WXT bundles Vite but does not
// expose `vite/client` types here.
declare module "*?raw" {
  const content: string;
  export default content;
}
