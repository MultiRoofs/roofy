import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar, formatCoordinate } from "../../../src/ui/StatusBar";
const baseProps = { objectCount: 10 };
describe("StatusBar", () => {
  it("formats the WGS84 [lng, lat, height] callback tuple", () => {
    expect(formatCoordinate([4.3571, 52.0116, 38])).toBe(
      "52.0116° N, 4.3571° E · 38 m",
    );
  });
  it("uses hemisphere labels for negative coordinates", () => {
    expect(formatCoordinate([-4.3571, -52.0116, 38])).toBe(
      "52.0116° S, 4.3571° W · 38 m",
    );
  });
  it("has no coordinates before a depth hit and documents ellipsoidal height", () => {
    render(<StatusBar {...baseProps} />);
    expect(screen.queryByText(/°/)).toBeNull();
    expect(screen.getByTitle("WGS84 ellipsoidal height")).toBeInTheDocument();
  });
  it("shows resident settled state", () => {
    render(
      <StatusBar {...baseProps} streamStatus="idle" residentCellCount={3} />,
    );
    expect(screen.getByText(/3 resident cells · Settled/)).toBeInTheDocument();
  });
  it.each([
    ["probing", "Probing…"],
    ["fetching", "Loading…"],
    ["too-far", "Zoom in to load"],
  ] as const)("shows %s stream state", (streamStatus, copy) => {
    render(<StatusBar {...baseProps} streamStatus={streamStatus} />);
    expect(screen.getByText(new RegExp(copy))).toBeInTheDocument();
  });
  it("preserves stream errors and never renders source EPSG coordinates", () => {
    render(
      <StatusBar
        {...baseProps}
        streamStatus="error"
        streamMessage="range read failed"
        cursorPosition={[4.3571, 52.0116, 38]}
      />,
    );
    expect(screen.getByText(/range read failed/)).toBeInTheDocument();
    expect(screen.queryByText(/EPSG:28992/)).toBeNull();
  });
});
