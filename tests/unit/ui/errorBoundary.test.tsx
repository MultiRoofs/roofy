/**
 * Unit tests for the ErrorBoundary component.
 *
 * Verifies that render errors are caught and a fallback UI is displayed
 * instead of a white-screen crash.
 *
 * Written in JSX (hence .tsx): `ErrorBoundaryProps.children` is required, so
 * the `createElement(Type, props, ...children)` form cannot type-check — the
 * positional children are not folded into the props type — and passing
 * `children` inside the props object is the one thing React lint forbids.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
      <ErrorBoundary>
        <div>OK</div>
      </ErrorBoundary>,
    );
    expect(container.textContent).toBe("OK");
  });

  it("catches render errors and shows full-page fallback", () => {
    const { container } = render(
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>,
    );
    expect(container.querySelector(".error-fullpage")).toBeTruthy();
    expect(container.textContent).toContain("Something went wrong");
    expect(container.textContent).toContain("Test crash");
  });

  it("shows inline fallback when mode is inline", () => {
    const { container } = render(
      <ErrorBoundary fallback="inline">
        <BrokenComponent />
      </ErrorBoundary>,
    );
    expect(container.querySelector(".error-inline")).toBeTruthy();
    expect(container.textContent).toContain("Test crash");
    expect(container.textContent).toContain("Retry");
  });
});
