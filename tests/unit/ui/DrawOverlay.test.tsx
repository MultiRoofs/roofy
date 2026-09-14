import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
const geoid = vi.hoisted(() => vi.fn(async () => 40));
vi.mock("@cityjson/navara-core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  geoidHeightAt: geoid,
}));
import { DrawOverlay } from "../../../src/ui/viewport/DrawOverlay";
import { useDrawStore } from "../../../src/features/drawing/drawStore";
import { useGeoLayerStore } from "../../../src/features/geoLayers/geoLayerStore";
import { useLayerStore } from "../../../src/features/layers/layerStore";
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";
afterEach(() => {
  cleanup();
  useDrawStore.getState().finish();
  useGeoLayerStore.setState({ layers: [] });
  useLayerStore.setState({ layers: [] });
});
function sketch() {
  useDrawStore.getState().create();
  useDrawStore.getState().start();
  const pick = vi
    .fn()
    .mockReturnValueOnce([4, 52, 45])
    .mockReturnValueOnce([4.001, 52, 45])
    .mockReturnValueOnce([4, 52.001, 45]);
  const scene = {
    current: { pickDrawingPoint: pick } as unknown as CitySceneHandle,
  };
  const view = render(<DrawOverlay scene={scene} />);
  const canvas = view.container.querySelector("svg")!;
  fireEvent.click(canvas, { clientX: 20, clientY: 20 });
  fireEvent.click(canvas, { clientX: 60, clientY: 20 });
  fireEvent.click(canvas, { clientX: 60, clientY: 60, detail: 1 });
  return view;
}
it("finishes a 2D drawing as a regular layer with an inline source", async () => {
  const view = sketch();
  fireEvent.doubleClick(view.container.querySelector("svg")!);
  fireEvent.pointerMove(view.container.querySelector("svg")!, {
    clientX: 60,
    clientY: 65,
  });
  await act(async () =>
    fireEvent.click(view.container.querySelector("svg")!, { detail: 1 }),
  );
  expect(useLayerStore.getState().layers).toHaveLength(1);
  expect(useLayerStore.getState().layers[0]?.model.bbox?.[2]).toBe(5);
  expect(useDrawStore.getState().active).toBe(false);
});
it("does not add geometry if cancelled while elevation is loading", async () => {
  let resolve!: (n: number) => void;
  geoid.mockImplementationOnce(
    () =>
      new Promise<number>((r) => {
        resolve = r;
      }),
  );
  const view = sketch();
  fireEvent.doubleClick(view.container.querySelector("svg")!);
  fireEvent.click(view.container.querySelector("svg")!, { detail: 1 });
  useDrawStore.getState().stop();
  view.unmount();
  await act(async () => resolve(40));
  expect(useLayerStore.getState().layers).toHaveLength(0);
});

it("starts without an instruction panel and double-click enters extrusion without adding a duplicate corner", () => {
  const view = sketch();
  expect(screen.queryByRole("region", { name: "Drawing controls" })).toBeNull();
  const canvas = view.container.querySelector("svg")!;
  fireEvent.click(canvas, { clientX: 60, clientY: 60, detail: 2 });
  fireEvent.doubleClick(canvas, { clientX: 60, clientY: 60 });
  expect(screen.getByRole("tooltip")).toHaveTextContent("10.0 m");
  expect(screen.queryByRole("region", { name: "Drawing controls" })).toBeNull();
  fireEvent.pointerMove(canvas, { clientX: 60, clientY: 10 });
  expect(screen.getByRole("tooltip")).toHaveTextContent("110.0 m");
  expect(canvas.querySelectorAll("circle")).toHaveLength(3);
  expect(useLayerStore.getState().layers).toHaveLength(0);
});

it("shows the live ground edge length and clears it when the pointer leaves", () => {
  useDrawStore.getState().create();
  useDrawStore.getState().start();
  const pick = vi
    .fn()
    .mockReturnValueOnce([4, 52, 45])
    .mockReturnValue([4.001, 52, 45]);
  const view = render(
    <DrawOverlay
      scene={{
        current: { pickDrawingPoint: pick } as unknown as CitySceneHandle,
      }}
    />,
  );
  const canvas = view.container.querySelector("svg")!;
  fireEvent.click(canvas, { clientX: 20, clientY: 20 });
  fireEvent.pointerMove(canvas, { clientX: 60, clientY: 20 });
  expect(screen.getByRole("tooltip").textContent).toMatch(/68\.5 m/);
  fireEvent.pointerLeave(canvas);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("adjusts extrusion height with the keyboard before confirming", () => {
  const view = sketch();
  const canvas = view.container.querySelector("svg")!;
  fireEvent.doubleClick(canvas);
  const overlay = view.container.querySelector(".draw-overlay")!;
  fireEvent.keyDown(overlay, { key: "ArrowUp", shiftKey: true });
  expect(screen.getByRole("tooltip")).toHaveTextContent("20.0 m");
  expect(screen.getByRole("status")).toHaveTextContent("Height 20 metres");
  fireEvent.keyDown(overlay, { key: "ArrowDown" });
  expect(screen.getByRole("tooltip")).toHaveTextContent("19.0 m");
});
