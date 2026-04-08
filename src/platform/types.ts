/**
 * Platform abstraction interfaces.
 *
 * These define the boundary between the application and platform-specific
 * APIs. v1 provides browser implementations. A future Tauri shell can
 * supply alternative implementations without changing feature code.
 */

/**
 * HTTP client for fetching remote resources.
 */
export interface HttpClient {
  fetchText(
    url: string,
  ): Promise<{ ok: boolean; status: number; statusText: string; text: string }>;
}

/**
 * Clipboard write service.
 */
export interface ClipboardService {
  writeText(text: string): Promise<boolean>;
}

/**
 * Platform services bundle — injected into the app shell.
 */
export interface PlatformServices {
  readonly http: HttpClient;
  readonly clipboard: ClipboardService;
}
