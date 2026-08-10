/**
 * Browser implementations of platform services.
 *
 * These use standard Web APIs (fetch, navigator.clipboard) and are
 * the default for the browser-first v1 deployment.
 */

import type { HttpClient, ClipboardService, PlatformServices } from "./types";

const browserHttp: HttpClient = {
  async fetchText(url: string) {
    const response = await fetch(url);
    const text = response.ok ? await response.text() : "";
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text,
    };
  },

  async fetchBytes(url: string) {
    const response = await fetch(url);
    const bytes = response.ok
      ? new Uint8Array(await response.arrayBuffer())
      : new Uint8Array();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      bytes,
    };
  },
};

const browserClipboard: ClipboardService = {
  async writeText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },
};

export const browserPlatform: PlatformServices = {
  http: browserHttp,
  clipboard: browserClipboard,
};
