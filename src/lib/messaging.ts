import type { BgMessage, BgResponse } from "./types";

// Chrome reports these when the service worker isn't listening yet — almost
// always because an idle MV3 worker is still cold-starting. The message never
// reached a handler, so retrying it is safe (no double-apply).
const COLD_START_ERROR = /could not establish connection|receiving end does not exist/i;
const RETRY_DELAY_MS = 150;

export function sendToBackground<T>(message: BgMessage, retries = 1): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: BgResponse<T> | undefined) => {
      const err = chrome.runtime.lastError;
      if (err) {
        if (retries > 0 && COLD_START_ERROR.test(err.message ?? "")) {
          setTimeout(() => {
            sendToBackground<T>(message, retries - 1).then(resolve, reject);
          }, RETRY_DELAY_MS);
          return;
        }
        return reject(new Error(err.message));
      }
      if (!response) return reject(new Error("No response from background"));
      if (!response.ok) return reject(new Error(response.error));
      resolve(response.data as T);
    });
  });
}

export function ok<T>(data: T): BgResponse<T> {
  return { ok: true, data };
}

export function fail(error: string): BgResponse<never> {
  return { ok: false, error };
}
