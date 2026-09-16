/** Mutation testing is intentionally limited to deterministic policy cores. Browser
 * instrumentation and React shells are exercised through integration checks instead. */
export default {
  mutate: [
    "src/capture-core/debugger/engine/page/network/policy.ts",
    "src/lib/dictation-policy.ts",
  ],
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  reporters: ["clear-text", "progress"],
  cleanTempDir: true,
  coverageAnalysis: "off",
  thresholds: {
    high: 80,
    low: 60,
    break: 60,
  },
};
