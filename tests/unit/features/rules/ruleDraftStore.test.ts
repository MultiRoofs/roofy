/**
 * The per-layer rule-editor draft store.
 *
 * Proves three things: a draft can be set and cleared, drafts for different
 * layers never bleed into each other, and a layer's draft is dropped the
 * moment that layer is removed from `useLayerStore` — the invariant
 * `installRuleDraftInvariants` installs.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  useRuleDraftStore,
  installRuleDraftInvariants,
  type RuleDraft,
} from "../../../../src/features/rules/ruleDraftStore";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { CityModel } from "../../../../src/domain/citymodel/types";

function emptyModel(): CityModel {
  return {
    sourceEncoding: "cityjson",
    metadata: {},
    bbox: null,
    objects: {},
    vertexCount: 0,
  } as CityModel;
}

function addLayer(id: string): void {
  useLayerStore.getState().addLayer({
    id,
    name: id,
    model: emptyModel(),
    modelRef: { type: "url", url: `https://x/${id}` },
    visible: true,
    rules: [],
    rulesEnabled: false,
  });
}

function draft(name: string): RuleDraft {
  return {
    editingId: null,
    open: true,
    form: { name, color: "#7cb518", logic: "AND", conditions: [] },
  };
}

afterEach(() => {
  useRuleDraftStore.setState({ drafts: {} });
  useLayerStore.setState({ layers: [] });
});

describe("ruleDraftStore", () => {
  it("sets and clears a layer's draft", () => {
    useRuleDraftStore.getState().setDraft("A", draft("first"));
    expect(useRuleDraftStore.getState().drafts.A).toEqual(draft("first"));

    useRuleDraftStore.getState().clearDraft("A");
    expect(useRuleDraftStore.getState().drafts.A).toBeNull();
  });

  it("keeps drafts for different layers isolated", () => {
    useRuleDraftStore.getState().setDraft("A", draft("a-draft"));
    useRuleDraftStore.getState().setDraft("B", draft("b-draft"));

    expect(useRuleDraftStore.getState().drafts.A).toEqual(draft("a-draft"));
    expect(useRuleDraftStore.getState().drafts.B).toEqual(draft("b-draft"));

    useRuleDraftStore.getState().clearDraft("A");
    expect(useRuleDraftStore.getState().drafts.A).toBeNull();
    expect(useRuleDraftStore.getState().drafts.B).toEqual(draft("b-draft"));
  });
});

describe("installRuleDraftInvariants", () => {
  it("drops a layer's draft when the layer is removed", () => {
    addLayer("A");
    const dispose = installRuleDraftInvariants();
    try {
      useRuleDraftStore.getState().setDraft("A", draft("a-draft"));
      expect(useRuleDraftStore.getState().drafts.A).toEqual(draft("a-draft"));

      useLayerStore.getState().removeLayer("A");

      expect(useRuleDraftStore.getState().drafts.A).toBeNull();
    } finally {
      dispose();
    }
  });

  it("leaves drafts for layers that still exist", () => {
    addLayer("A");
    addLayer("B");
    const dispose = installRuleDraftInvariants();
    try {
      useRuleDraftStore.getState().setDraft("A", draft("a-draft"));
      useRuleDraftStore.getState().setDraft("B", draft("b-draft"));

      useLayerStore.getState().removeLayer("A");

      expect(useRuleDraftStore.getState().drafts.A).toBeNull();
      expect(useRuleDraftStore.getState().drafts.B).toEqual(draft("b-draft"));
    } finally {
      dispose();
    }
  });

  it("a second install disposes the first", () => {
    addLayer("A");
    const first = installRuleDraftInvariants();
    const second = installRuleDraftInvariants();
    useRuleDraftStore.getState().setDraft("A", draft("a-draft"));

    // The first installer's subscription is gone; disposing it must not
    // touch the second (live) one's subscription.
    first();
    useLayerStore.getState().removeLayer("A");
    expect(useRuleDraftStore.getState().drafts.A).toBeNull();

    second();
  });
});
