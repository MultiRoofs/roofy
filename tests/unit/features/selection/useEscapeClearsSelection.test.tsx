import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useSelectionStore } from "../../../../src/features/selection/selectionStore";
import { useEscapeClearsSelection } from "../../../../src/features/selection/useEscapeClearsSelection";

function Host() {
  useEscapeClearsSelection();
  return null;
}

function pressEscape(target: EventTarget = window) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
}

function selectSomething() {
  useSelectionStore
    .getState()
    .select({ kind: "object", layerId: "L", objectId: "o1" });
}

describe("useEscapeClearsSelection", () => {
  // Explicit: auto-cleanup only runs with vitest `globals`, which this project
  // does not enable — without it a mounted host's listener outlives its test.
  afterEach(cleanup);

  beforeEach(() => {
    useSelectionStore.setState({
      selections: [],
      hovered: null,
      geoSelection: null,
    });
  });
  it("clears the selection on Escape", () => {
    render(<Host />);
    selectSomething();
    pressEscape();
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("clears a geo feature selection too", () => {
    render(<Host />);
    useSelectionStore
      .getState()
      .selectGeoFeature({ geoLayerId: "G", batchId: 0, properties: {} });
    pressEscape();
    expect(useSelectionStore.getState().geoSelection).toBeNull();
  });

  it("leaves the selection alone while a modal is open", () => {
    render(<Host />);
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    document.body.appendChild(backdrop);
    selectSomething();
    pressEscape();
    expect(useSelectionStore.getState().selections).toHaveLength(1);
    backdrop.remove();
  });

  it("leaves the selection alone when a text field has the key", () => {
    render(<Host />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    selectSomething();
    pressEscape(input);
    expect(useSelectionStore.getState().selections).toHaveLength(1);
  });

  it("ignores keys other than Escape", () => {
    render(<Host />);
    selectSomething();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(useSelectionStore.getState().selections).toHaveLength(1);
  });

  it("stops listening once unmounted", () => {
    const { unmount } = render(<Host />);
    unmount();
    selectSomething();
    pressEscape();
    expect(useSelectionStore.getState().selections).toHaveLength(1);
  });
});
