import { toHeaderRecord } from "../../headers";
import { getRequestBodyPreview, shouldCaptureTextContent } from "../../serializer";
import type { Reporter } from "../../types";
import { redactSensitiveQueryParams, sanitizeCapturedBody, toAbsoluteUrl } from "../../utils";
import type { NetworkCapturePolicy } from "../policy";
import { getRequestBodyPreviewAsync, getTextBodyPreviewAsync } from "../shared";
import type { FetchCaptureContext } from "./types";

const resolveFetchMethod = (input: RequestInfo | URL, init: RequestInit | undefined): string => {
  if (typeof init?.method === "string" && init.method) {
    return init.method.toUpperCase();
  }

  if (input instanceof Request) {
    return input.method.toUpperCase();
  }

  return "GET";
};

const resolveFetchUrl = (input: RequestInfo | URL): string => {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
};

const getFetchRequestBodyPreview = async (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  requestHeaders: Headers | null,
  stringifyValue: (value: unknown) => string,
  reporter: Reporter
): Promise<string | undefined> => {
  const contentType =
    requestHeaders?.get("content-type") ??
    (input instanceof Request ? (input.headers.get("content-type") ?? "") : "");
  const initBodyPreview = getRequestBodyPreview(init?.body, stringifyValue);
  if (initBodyPreview) {
    return sanitizeCapturedBody(initBodyPreview, contentType);
  }

  if (!(input instanceof Request) || !shouldCaptureTextContent(contentType)) {
    return undefined;
  }

  const method = (init?.method ?? input.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || input.bodyUsed) {
    return undefined;
  }

  try {
    return sanitizeCapturedBody(await input.clone().text(), contentType);
  } catch (error) {
    reporter.reportNonFatalError(
      "Failed to capture fetch request body in debugger instrumentation",
      error
    );
    return undefined;
  }
};

const resolveFetchRequestBodyPromise = (
  requestInput: RequestInfo | URL,
  requestInit: RequestInit | undefined,
  requestHeaderSource: Headers | null,
  stringifyValue: (value: unknown) => string,
  reporter: Reporter,
  requestBodyByRequest: WeakMap<Request, Promise<string | undefined>>
): Promise<string | undefined> => {
  if (requestInput instanceof Request) {
    return (
      requestBodyByRequest.get(requestInput) ??
      getFetchRequestBodyPreview(
        requestInput,
        requestInit,
        requestHeaderSource,
        stringifyValue,
        reporter
      )
    );
  }

  return getFetchRequestBodyPreview(
    requestInput,
    requestInit,
    requestHeaderSource,
    stringifyValue,
    reporter
  );
};

export const resolveFetchContext = (
  args: Parameters<typeof window.fetch>,
  reporter: Reporter,
  stringifyValue: (value: unknown) => string,
  requestBodyByRequest: WeakMap<Request, Promise<string | undefined>>,
  policy: NetworkCapturePolicy
): FetchCaptureContext | null => {
  const [requestInput, requestInit] = args;
  const method = resolveFetchMethod(requestInput, requestInit);
  const url = resolveFetchUrl(requestInput);
  const absoluteUrl = toAbsoluteUrl(url, reporter);
  if (!absoluteUrl || !policy.shouldCaptureUrl(absoluteUrl)) {
    return null;
  }

  let requestHeaderSource: Headers | null = null;
  if (requestInit?.headers) {
    try {
      requestHeaderSource = new Headers(requestInit.headers);
    } catch (error) {
      reporter.reportNonFatalError(
        "Failed to normalize fetch headers in debugger instrumentation",
        error
      );
    }
  } else if (requestInput instanceof Request) {
    requestHeaderSource = requestInput.headers;
  }

  const requestHeaders = requestHeaderSource
    ? toHeaderRecord(requestHeaderSource, policy.shouldCaptureHeader)
    : requestInput instanceof Request
      ? toHeaderRecord(requestInput.headers, policy.shouldCaptureHeader)
      : {};

  const requestContentType =
    requestHeaderSource?.get("content-type") ??
    (requestInput instanceof Request ? (requestInput.headers.get("content-type") ?? "") : "");

  const requestBodyPromise = policy.captureRequestBodies
    ? resolveFetchRequestBodyPromise(
        requestInput,
        requestInit,
        requestHeaderSource,
        stringifyValue,
        reporter,
        requestBodyByRequest
      )
    : Promise.resolve(undefined);

  return {
    method,
    normalizedUrl: redactSensitiveQueryParams(absoluteUrl),
    requestHeaders,
    requestContentType,
    requestBodyPromise,
  };
};

export const installRequestConstructorCapture = (
  reporter: Reporter,
  stringifyValue: (value: unknown) => string,
  requestBodyByRequest: WeakMap<Request, Promise<string | undefined>>
): void => {
  if (typeof window.Request !== "function") {
    return;
  }

  const OriginalRequest = window.Request;
  const patchedRequest = new Proxy(OriginalRequest, {
    construct(target, argArray, newTarget) {
      const [, requestInit] = argArray as [RequestInfo | URL, RequestInit | undefined];
      const requestInstance = Reflect.construct(target, argArray, newTarget) as Request;

      let requestHeaderSource: Headers;
      if (requestInit?.headers !== undefined) {
        try {
          requestHeaderSource = new Headers(requestInit.headers);
        } catch (error) {
          reporter.reportNonFatalError(
            "Failed to normalize Request headers in debugger instrumentation",
            error
          );
          requestHeaderSource = requestInstance.headers;
        }
      } else {
        requestHeaderSource = requestInstance.headers;
      }

      const contentType = requestHeaderSource.get("content-type") ?? "";

      const requestBodyPromise =
        requestInit?.body !== undefined
          ? getRequestBodyPreviewAsync(reporter, requestInit.body, stringifyValue, contentType)
          : getTextBodyPreviewAsync(
              reporter,
              contentType,
              "Failed to capture Request body text in debugger instrumentation",
              () => {
                if (requestInstance.bodyUsed) {
                  return Promise.resolve("");
                }

                return requestInstance.clone().text();
              }
            );

      requestBodyByRequest.set(requestInstance, requestBodyPromise);
      return requestInstance;
    },
  });

  try {
    Object.assign(patchedRequest, OriginalRequest);
  } catch (error) {
    reporter.reportNonFatalError(
      "Failed to mirror Request constructor properties in debugger instrumentation",
      error
    );
  }

  try {
    window.Request = patchedRequest as typeof Request;
  } catch (error) {
    reporter.reportNonFatalError(
      "Failed to patch Request constructor in debugger instrumentation",
      error
    );
  }
};
