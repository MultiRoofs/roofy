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
  fireEvent.click(canvas, { clientX: 60, clientY: 60 });
  return view;
}
it("finishes a 2D drawing as a regular layer with an inline source", async () => {
  sketch();
  await act(async () => fireEvent.click(screen.getByText("Finish as 2D")));
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
  fireEvent.click(screen.getByText("Finish as 2D"));
  useDrawStore.getState().stop();
  view.unmount();
  await act(async () => resolve(40));
  expect(useLayerStore.getState().layers).toHaveLength(0);
});
