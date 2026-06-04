import type { BgMessage, BgResponse } from "./types";

export function sendToBackground<T>(message: BgMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: BgResponse<T> | undefined) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
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
