/**
 * Unit tests for the ErrorBoundary component.
 *
 * Verifies that render errors are caught and a fallback UI is displayed
 * instead of a white-screen crash.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, cleanup } from "@testing-library/react";
import { ErrorBoundary } from "../../../src/ui/ErrorBoundary";

// Suppress React error logging during tests
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
});

function BrokenComponent(): never {
  throw new Error("Test crash");
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    const { container } = render(
      createElement(ErrorBoundary, null, createElement("div", null, "OK")),
    );
    expect(container.textContent).toBe("OK");
  });

  it("catches render errors and shows full-page fallback", () => {
    const { container } = render(
      createElement(ErrorBoundary, null, createElement(BrokenComponent)),
    );
    expect(container.querySelector(".error-fullpage")).toBeTruthy();
    expect(container.textContent).toContain("Something went wrong");
    expect(container.textContent).toContain("Test crash");
  });

  it("shows inline fallback when mode is inline", () => {
    const { container } = render(
      createElement(
        ErrorBoundary,
        { fallback: "inline" },
        createElement(BrokenComponent),
      ),
    );
    expect(container.querySelector(".error-inline")).toBeTruthy();
    expect(container.textContent).toContain("Test crash");
    expect(container.textContent).toContain("Retry");
  });
});
