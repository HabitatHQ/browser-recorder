import { describe, expect, it } from "vitest";
import { evaluateLocalDictation } from "./dictation-policy";

describe("evaluateLocalDictation", () => {
  it("fails closed unless local processing is explicitly available", () => {
    expect(
      evaluateLocalDictation({ recognitionAvailable: false, localProcessingAvailable: true })
    ).toEqual({
      available: false,
      reason: "recognition-unavailable",
    });
    expect(
      evaluateLocalDictation({ recognitionAvailable: true, localProcessingAvailable: false })
    ).toEqual({
      available: false,
      reason: "local-processing-unavailable",
    });
    expect(
      evaluateLocalDictation({ recognitionAvailable: true, localProcessingAvailable: true })
    ).toEqual({
      available: true,
      reason: null,
    });
  });
});
