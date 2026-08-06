/**
 * Unit tests for browser platform implementation.
 *
 * Verifies the browser implementations satisfy the PlatformServices
 * interface contract.
 */

import { describe, it, expect } from "vitest";
import { browserPlatform } from "../../../src/platform/browser";

describe("browserPlatform", () => {
  it("exposes http service", () => {
    expect(browserPlatform.http).toBeDefined();
    expect(typeof browserPlatform.http.fetchText).toBe("function");
    expect(typeof browserPlatform.http.fetchBytes).toBe("function");
  });

  it("exposes clipboard service", () => {
    expect(browserPlatform.clipboard).toBeDefined();
    expect(typeof browserPlatform.clipboard.writeText).toBe("function");
  });
});
