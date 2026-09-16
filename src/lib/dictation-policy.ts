export type LocalDictationDecision =
  | { available: true; reason: null }
  | { available: false; reason: "recognition-unavailable" | "local-processing-unavailable" };

export const evaluateLocalDictation = (capability: {
  recognitionAvailable: boolean;
  localProcessingAvailable: boolean;
}): LocalDictationDecision => {
  if (!capability.recognitionAvailable) {
    return { available: false, reason: "recognition-unavailable" };
  }
  if (!capability.localProcessingAvailable) {
    return { available: false, reason: "local-processing-unavailable" };
  }
  return { available: true, reason: null };
};
