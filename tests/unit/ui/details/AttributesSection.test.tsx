/**
 * The details attributes section: two-column rows, and a search field that
 * filters by key when there are more than eight.
 */
import { describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AttributesSection } from "../../../../src/ui/details/AttributesSection";

describe("AttributesSection", () => {
  it("renders all attributes with no search field under eight rows", () => {
    render(<AttributesSection attributes={{ a: 1, b: "x", c: true }} />);
    expect(screen.getByText("a")).toBeTruthy();
    expect(screen.getByText("b")).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
    cleanup();
  });

  it("shows a search field above eight rows and filters by key", () => {
    const attributes = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`key-${i}`, i]),
    );
    render(<AttributesSection attributes={attributes} />);

    const search = screen.getByRole("searchbox");
    expect(search).toBeTruthy();

    fireEvent.change(search, { target: { value: "key-1" } });
    // Only keys containing "key-1" remain.
    expect(screen.getByText("key-1")).toBeTruthy();
    expect(screen.getByText("key-10")).toBeTruthy();
    expect(screen.queryByText("key-2")).toBeNull();
    cleanup();
  });

  it("says so when there are no attributes", () => {
    render(<AttributesSection attributes={{}} />);
    expect(screen.getByText("No attributes")).toBeTruthy();
    cleanup();
  });
});
