import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  useLayerStore,
  type LayerStoreActions,
} from "../../../../src/features/layers/layerStore";
import {
  useGeoLayerStore,
  type GeoLayerInput,
} from "../../../../src/features/geoLayers/geoLayerStore";
import { useSelectionStore } from "../../../../src/features/selection/selectionStore";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";
import {
  activateLayer,
  installWorkspaceInvariants,
  nextActiveAfterRemoval,
  selectionLayerId,
} from "../../../../src/features/workspace/layerCoordination";
import type { CityModel } from "../../../../src/domain/citymodel/types";

type LayerInput = Parameters<LayerStoreActions["addLayer"]>[0];

function makeModel(id = "m1"): CityModel {
  return {
    objects: {
      [id]: {
        id,
        objectType: "Building",
        surfaces: [],
        attributes: {},
        children: [],
        parents: [],
        bbox: null,
        lod: null,
      },
    },
    metadata: { referenceSystem: undefined },
    bbox: null,
  } as unknown as CityModel;
}

function layerInput(name: string): LayerInput {
  return {
    name,
    model: makeModel(name),
    modelRef: { type: "url", url: `https://x/${name}` },
    visible: true,
    rules: [],
    colorBy: "surface",
  };
}

function geoInput(name: string): GeoLayerInput {
  return {
    kind: "geojson",
    name,
    config: { data: { type: "FeatureCollection", features: [] } },
  };
}

describe("nextActiveAfterRemoval", () => {
  it("prefers the next id, then the previous, then null", () => {
    expect(nextActiveAfterRemoval(["a", "b", "c"], "b", 1)).toBe("c");
    expect(nextActiveAfterRemoval(["a", "b", "c"], "c", 2)).toBe("b");
    expect(nextActiveAfterRemoval(["a"], "a", 0)).toBeNull();
  });

  it("falls back to the first remaining id when the index is unknown", () => {
    expect(nextActiveAfterRemoval(["a", "b", "c"], "b", -1)).toBe("a");
  });
});

describe("selectionLayerId", () => {
  it("reads the city owner or the geo owner", () => {
    expect(
      selectionLayerId({
        selections: [{ kind: "object", layerId: "L", objectId: "o" }],
        geoSelection: null,
      }),
    ).toBe("L");
    expect(
      selectionLayerId({
        selections: [],
        geoSelection: { geoLayerId: "G", batchId: 0, properties: {} },
      }),
    ).toBe("G");
    expect(selectionLayerId({ selections: [], geoSelection: null })).toBeNull();
  });
});

describe("activateLayer + invariants", () => {
  let dispose: () => void;
  beforeEach(() => {
    useLayerStore.setState({ layers: [] });
    useGeoLayerStore.setState({ layers: [] });
    useSelectionStore.setState({
      selections: [],
      hovered: null,
      geoSelection: null,
      mode: "object",
    });
    useWorkspaceStore.setState({ activeLayerId: null });
    dispose = installWorkspaceInvariants();
  });
  afterEach(() => dispose());

  it("the first added layer becomes active; later adds do not steal it", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    expect(useWorkspaceStore.getState().activeLayerId).toBe(a);
    useLayerStore.getState().addLayer(layerInput("B"));
    expect(useWorkspaceStore.getState().activeLayerId).toBe(a);
  });

  it("activating another layer clears a selection that belongs to the previous one", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    const b = useLayerStore.getState().addLayer(layerInput("B"));
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: a, objectId: "o1" });
    activateLayer(b);
    expect(useSelectionStore.getState().selections).toEqual([]);
    expect(useWorkspaceStore.getState().activeLayerId).toBe(b);
  });

  it("a VECTOR layer becoming active keeps a CITY layer's selection (F5)", () => {
    // §10.11's Aggregate run scoped to "Selected": the tool is offered only
    // while the VECTOR target is active, and §7.6's scope counts the SOURCE
    // city layer's selection — so clearing that selection on the way to the
    // target made the scope unreachable through the UI. §6 settles it: changing
    // the target does not change what the run is scoped to. Narrow on purpose:
    // a vector layer owns areas, never buildings, so it cannot be the owner of
    // the selection it is being handed the focus over.
    const city = useLayerStore.getState().addLayer(layerInput("Delft"));
    const zones = useGeoLayerStore.getState().addGeoLayer(geoInput("Zones"));
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: city, objectId: "o1" });
    activateLayer(zones);
    expect(useWorkspaceStore.getState().activeLayerId).toBe(zones);
    expect(useSelectionStore.getState().selections).toHaveLength(1);
    // And the reconciler does not hand the activation straight back: rule 2 is
    // about a NEW pick, and nothing was picked here.
    expect(useWorkspaceStore.getState().activeLayerId).toBe(zones);
  });

  it("still clears a city selection for another CITY layer (F5 stays narrow)", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    const b = useLayerStore.getState().addLayer(layerInput("B"));
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: a, objectId: "o1" });
    activateLayer(b);
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("still clears a GEO selection when another vector layer becomes active (F5)", () => {
    // The exemption is for a CITY selection only: two vector layers are the
    // case rule 1 exists for, and a geo selection has no scope to freeze.
    const g1 = useGeoLayerStore.getState().addGeoLayer(geoInput("G1"));
    const g2 = useGeoLayerStore.getState().addGeoLayer(geoInput("G2"));
    useSelectionStore
      .getState()
      .selectGeoFeature({ geoLayerId: g1, batchId: 0, properties: {} });
    activateLayer(g2);
    expect(useSelectionStore.getState().geoSelection).toBeNull();
    expect(useWorkspaceStore.getState().activeLayerId).toBe(g2);
  });

  it("a HOVER does not hand the activation back to the city layer (F5)", () => {
    // The regression the M3 gate's second pass found: rule 2 subscribed to
    // EVERY selection-store write, and the store carries the hover, the pick
    // mode and the tool mode beside the selection. So the user who selected
    // two buildings, went to the vector target and then moved the mouse over
    // the model was thrown back to the city layer — and §10.11's run with it.
    const city = useLayerStore.getState().addLayer(layerInput("Delft"));
    const zones = useGeoLayerStore.getState().addGeoLayer(geoInput("Zones"));
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: city, objectId: "o1" });
    activateLayer(zones);

    useSelectionStore
      .getState()
      .hover({ kind: "object", layerId: city, objectId: "o2" });
    expect(useWorkspaceStore.getState().activeLayerId).toBe(zones);
    useSelectionStore.getState().hover(null);
    expect(useWorkspaceStore.getState().activeLayerId).toBe(zones);
    // The tool mode and the pick mode are the same kind of write — and the
    // pick-mode one REBUILDS the selection array (it narrows surface picks to
    // their objects), which is why the comparison is of the selected ids and
    // not of the array's identity.
    useSelectionStore.getState().setToolMode("measure");
    expect(useWorkspaceStore.getState().activeLayerId).toBe(zones);
    useSelectionStore.getState().setMode("surface");
    useSelectionStore.getState().setMode("object");
    expect(useWorkspaceStore.getState().activeLayerId).toBe(zones);
    // And the selection is still there to be run on.
    expect(useSelectionStore.getState().selections).toHaveLength(1);
  });

  it("a real pick after all that still coordinates (F5)", () => {
    const city = useLayerStore.getState().addLayer(layerInput("Delft"));
    const zones = useGeoLayerStore.getState().addGeoLayer(geoInput("Zones"));
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: city, objectId: "o1" });
    activateLayer(zones);
    useSelectionStore
      .getState()
      .hover({ kind: "object", layerId: city, objectId: "o2" });
    // A DIFFERENT building: rule 2 is untouched, and the city layer takes the
    // focus back.
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: city, objectId: "o2" });
    expect(useWorkspaceStore.getState().activeLayerId).toBe(city);
  });

  it("a pick activates its owning layer", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    const b = useLayerStore.getState().addLayer(layerInput("B"));
    activateLayer(a);
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: b, objectId: "o1" });
    expect(useWorkspaceStore.getState().activeLayerId).toBe(b);
    expect(useSelectionStore.getState().selections).toHaveLength(1);
  });

  it("removing the active layer hands over to the next in list order, and clears its selection", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    const b = useLayerStore.getState().addLayer(layerInput("B"));
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: a, objectId: "o1" });
    useLayerStore.getState().removeLayer(a);
    expect(useWorkspaceStore.getState().activeLayerId).toBe(b);
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("removing the last layer leaves no active layer", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    useLayerStore.getState().removeLayer(a);
    expect(useWorkspaceStore.getState().activeLayerId).toBeNull();
  });

  it("removing several layers at once leaves no active layer", () => {
    useLayerStore.getState().addLayer(layerInput("A"));
    useLayerStore.getState().addLayer(layerInput("B"));
    useLayerStore.getState().removeAllLayers();
    expect(useWorkspaceStore.getState().activeLayerId).toBeNull();
  });

  it("hiding the selection's layer clears the selection", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    useSelectionStore
      .getState()
      .select({ kind: "surface", layerId: a, objectId: "o1", surfaceIndex: 2 });
    useLayerStore.getState().updateLayer(a, { visible: false });
    expect(useSelectionStore.getState().selections).toEqual([]);
  });

  it("activating the layer that owns the selection keeps the selection", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: a, objectId: "o1" });
    activateLayer(a);
    expect(useSelectionStore.getState().selections).toHaveLength(1);
  });

  it("hiding a geo layer clears its feature selection", () => {
    const g = useGeoLayerStore.getState().addGeoLayer(geoInput("G"));
    useSelectionStore
      .getState()
      .selectGeoFeature({ geoLayerId: g, batchId: 0, properties: {} });
    useGeoLayerStore.getState().updateGeoLayer(g, { visible: false });
    expect(useSelectionStore.getState().geoSelection).toBeNull();
  });

  it("closing every city layer while geo layers survive hands the active layer to a geo layer", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    const g = useGeoLayerStore.getState().addGeoLayer(geoInput("G"));
    activateLayer(a);
    useLayerStore.getState().removeAllLayers();
    expect(useWorkspaceStore.getState().activeLayerId).toBe(g);
  });

  it("no active layer while layers exist is not a durable state: the reconciler picks the first", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    activateLayer(null);
    useLayerStore.getState().updateLayer(a, { name: "renamed" });
    expect(useWorkspaceStore.getState().activeLayerId).toBe(a);
  });

  it("clear() also ends a geo selection (what keeps activate and pick from fighting)", () => {
    const g = useGeoLayerStore.getState().addGeoLayer(geoInput("G"));
    useSelectionStore
      .getState()
      .selectGeoFeature({ geoLayerId: g, batchId: 0, properties: {} });
    useSelectionStore.getState().clear();
    expect(useSelectionStore.getState().geoSelection).toBeNull();
  });

  it("a geo layer takes part in the same rules", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    const g = useGeoLayerStore.getState().addGeoLayer(geoInput("G"));
    useSelectionStore
      .getState()
      .selectGeoFeature({ geoLayerId: g, batchId: 0, properties: {} });
    expect(useWorkspaceStore.getState().activeLayerId).toBe(g);
    activateLayer(a);
    expect(useSelectionStore.getState().geoSelection).toBeNull();
    useGeoLayerStore.getState().removeGeoLayer(g);
    expect(useWorkspaceStore.getState().activeLayerId).toBe(a);
  });

  it("hiding a different layer leaves the selection and the active id alone", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    const b = useLayerStore.getState().addLayer(layerInput("B"));
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: a, objectId: "o1" });
    useLayerStore.getState().updateLayer(b, { visible: false });
    expect(useSelectionStore.getState().selections).toHaveLength(1);
    expect(useWorkspaceStore.getState().activeLayerId).toBe(a);
  });

  it("replacing every layer in one write activates a survivor rather than none", () => {
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    expect(useWorkspaceStore.getState().activeLayerId).toBe(a);
    // One write that removes the active layer AND introduces its replacement:
    // there is no id in the previous order to hand over to, so only the
    // post-condition can save the workspace from "layers but nothing active".
    useLayerStore.setState({
      layers: [{ ...useLayerStore.getState().layers[0]!, id: "fresh" }],
    });
    expect(useWorkspaceStore.getState().activeLayerId).toBe("fresh");
  });

  it("installing over a selection on a later layer activates its owner, not the first layer", () => {
    dispose();
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    const b = useLayerStore.getState().addLayer(layerInput("B"));
    useSelectionStore
      .getState()
      .select({ kind: "object", layerId: b, objectId: "o1" });
    useWorkspaceStore.setState({ activeLayerId: null });
    dispose = installWorkspaceInvariants();
    expect(useWorkspaceStore.getState().activeLayerId).toBe(b);
    expect(useSelectionStore.getState().selections).toHaveLength(1);
    expect(a).not.toBe(b);
  });

  it("a second install disposes the first, and the first disposer is inert", () => {
    const second = installWorkspaceInvariants();
    dispose(); // the first one: already disposed, must not unhook the second
    const a = useLayerStore.getState().addLayer(layerInput("A"));
    expect(useWorkspaceStore.getState().activeLayerId).toBe(a);
    second();
    useLayerStore.getState().addLayer(layerInput("B"));
    expect(useWorkspaceStore.getState().activeLayerId).toBe(a);
  });
});
