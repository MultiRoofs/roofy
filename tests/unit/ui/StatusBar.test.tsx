/**
 * Component tests for StatusBar's streaming status readout.
 *
 * Covers the exact wording the task brief pins down: "too-far" always
 * shows the fixed, user-facing "Zoom in to load features" — NOT the
 * driver's internal reason-coded message (`FcbStreamLayerHandle.commit`
 * emits `"Zoom in (${plan.reason})"`, which is debug detail, not UI copy).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StatusBar } from "../../../src/ui/StatusBar";

afterEach(() => {
  cleanup();
});

const baseProps = {
  objectCount: 10,
  triangleCount: 100,
  selectedCount: 0,
};

describe("StatusBar — streaming status", () => {
  it("shows nothing when streamStatus is undefined (non-streaming active layer)", () => {
    render(<StatusBar {...baseProps} />);
    expect(screen.queryByText("Stream")).toBeNull();
  });

  it("shows nothing for 'idle' — nothing notable to report", () => {
    render(<StatusBar {...baseProps} streamStatus="idle" />);
    expect(screen.queryByText("Stream")).toBeNull();
  });

  it("shows 'Probing…' for 'probing'", () => {
    render(<StatusBar {...baseProps} streamStatus="probing" />);
    expect(screen.getByText("Probing…")).toBeTruthy();
  });

  it("shows 'Loading features…' for 'fetching'", () => {
    render(<StatusBar {...baseProps} streamStatus="fetching" />);
    expect(screen.getByText("Loading features…")).toBeTruthy();
  });

  it("shows the fixed 'Zoom in to load features' for 'too-far', ignoring the internal reason message", () => {
    render(
      <StatusBar
        {...baseProps}
        streamStatus="too-far"
        streamMessage="Zoom in (feature-budget)"
      />,
    );
    expect(screen.getByText("Zoom in to load features")).toBeTruthy();
    expect(screen.queryByText("Zoom in (feature-budget)")).toBeNull();
  });

  it("shows the worker's own message for 'error'", () => {
    render(
      <StatusBar
        {...baseProps}
        streamStatus="error"
        streamMessage="range read failed: 416 Range Not Satisfiable"
      />,
    );
    expect(
      screen.getByText("range read failed: 416 Range Not Satisfiable"),
    ).toBeTruthy();
  });

  it("falls back to a generic 'Streaming error' when 'error' has no message", () => {
    render(
      <StatusBar {...baseProps} streamStatus="error" streamMessage={null} />,
    );
    expect(screen.getByText("Streaming error")).toBeTruthy();
  });

  it("gives 'too-far' a visibly different status dot than 'error'", () => {
    const { container: tooFar } = render(
      <StatusBar {...baseProps} streamStatus="too-far" />,
    );
    const { container: error } = render(
      <StatusBar {...baseProps} streamStatus="error" streamMessage="x" />,
    );
    const tooFarDot = tooFar.querySelector(".status-dot.dot-partial");
    const errorDot = error.querySelector(".status-dot.dot-error");
    expect(tooFarDot).toBeTruthy();
    expect(errorDot).toBeTruthy();
  });
});
