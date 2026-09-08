import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SceneButtons } from "../../../src/ui/viewport/SceneButtons";
import { useSceneSheetStore } from "../../../src/features/sceneSheet/sceneSheetStore";
import { useSelectionStore } from "../../../src/features/selection/selectionStore";
import { useEscapeClearsSelection } from "../../../src/features/selection/useEscapeClearsSelection";
function Escape() {
  useEscapeClearsSelection();
  return null;
}
afterEach(() => {
  cleanup();
  useSceneSheetStore.setState({ sheet: null });
});
describe("SceneButtons", () => {
  it("keeps one sheet open and map clicks do not dismiss it", () => {
    render(
      <>
        <div data-testid="map" />
        <SceneButtons
          renderSun={(close) => <button onClick={close}>close sun</button>}
          renderSettings={() => <div>settings</div>}
        />
      </>,
    );
    fireEvent.click(screen.getByText("Sun & shade"));
    expect(screen.getByText("close sun")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Scene settings"));
    expect(screen.queryByText("close sun")).toBeNull();
    fireEvent.click(screen.getByTestId("map"));
    expect(screen.getByText("settings")).toBeInTheDocument();
  });
  it("first Escape closes sheet and second clears selection, while modals win", () => {
    useSelectionStore.setState({
      selections: [{ kind: "object", layerId: "x", objectId: "y" }],
    });
    render(
      <>
        <Escape />
        <SceneButtons
          renderSun={() => <div>sun</div>}
          renderSettings={() => <div>settings</div>}
        />
      </>,
    );
    fireEvent.click(screen.getByText("Sun & shade"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useSceneSheetStore.getState().sheet).toBeNull();
    expect(useSelectionStore.getState().selections).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useSelectionStore.getState().selections).toHaveLength(0);
  });
});
