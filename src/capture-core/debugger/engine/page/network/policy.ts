import { shouldHideHeader } from "../utils";

export interface NetworkCapturePolicyInput {
  exclusionPatterns?: readonly string[];
  captureRequestBodies?: boolean;
  captureXhrFetchResponseBodies?: boolean;
  customRedactedHeaders?: readonly string[];
}

export interface NetworkCapturePolicy {
  captureRequestBodies: boolean;
  captureResponseBodies: boolean;
  shouldCaptureUrl: (url: string) => boolean;
  shouldCaptureHeader: (name: string) => boolean;
}

const toGlobRegExp = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i");
};

export const compileNetworkCapturePolicy = (
  input: NetworkCapturePolicyInput = {}
): NetworkCapturePolicy => {
  const exclusions = (input.exclusionPatterns ?? [])
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map(toGlobRegExp);
  const protectedHeaders = new Set(
    (input.customRedactedHeaders ?? []).map((header) => header.trim().toLowerCase()).filter(Boolean)
  );

  return {
    captureRequestBodies: input.captureRequestBodies ?? true,
    captureResponseBodies: input.captureXhrFetchResponseBodies ?? true,
    shouldCaptureUrl: (url) => !exclusions.some((pattern) => pattern.test(url)),
    shouldCaptureHeader: (name) => {
      const normalized = name.trim().toLowerCase();
      return (
        Boolean(normalized) && !shouldHideHeader(normalized) && !protectedHeaders.has(normalized)
      );
    },
  };
};

export const shouldCaptureNetworkUrl = (policy: NetworkCapturePolicy, url: string): boolean => {
  return policy.shouldCaptureUrl(url);
};

export const filterHeaderRecord = (
  policy: NetworkCapturePolicy,
  headers: Record<string, string>
): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (policy.shouldCaptureHeader(name)) {
      result[name] = value;
    }
  }
  return result;
};
