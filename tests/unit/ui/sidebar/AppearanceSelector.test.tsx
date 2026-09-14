import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppearanceSelector } from "../../../../src/ui/sidebar/AppearanceSelector";
import {
  appearanceFromOptionValue,
  appearanceOptionValue,
} from "../../../../src/ui/sidebar/appearanceOption";
import { useLayerStore } from "../../../../src/features/layers/layerStore";
import type { AppearanceTheme } from "@cityjson/navara-core";
import { useWorkspaceStore } from "../../../../src/features/workspace/workspaceStore";

const themes: AppearanceTheme[] = [
  { kind: "texture", name: "rgbTexture" },
  { kind: "material", name: "paint" },
];

afterEach(() => {
  cleanup();
  useLayerStore.setState({ layers: [] });
  useWorkspaceStore.setState({ activeLayerId: null });
});

describe("AppearanceSelector", () => {
  it("renders nothing for a layer without themes", () => {
    const { container } = render(
      <AppearanceSelector
        layerId="L1"
        themes={[]}
        selected={null}
        texturesResolvable
      />,
    );
    expect(container.querySelector("select")).toBeNull();
  });

  it("lists None plus every theme by kind and name, with the selection", () => {
    render(
      <AppearanceSelector
        layerId="L1"
        themes={themes}
        selected={themes[0]!}
        texturesResolvable
      />,
    );
    const select = screen.getByLabelText("Appearance") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(["None", "Texture: rgbTexture", "Material: paint"]);
    expect(select.value).toBe("texture:rgbTexture");
  });

  it("pushes the picked theme (or null) into the store", () => {
    const setLayerAppearance = vi.fn();
    useLayerStore.setState({ setLayerAppearance } as never);
    render(
      <AppearanceSelector
        layerId="L1"
        themes={themes}
        selected={null}
        texturesResolvable
      />,
    );
    const select = screen.getByLabelText("Appearance");
    fireEvent.change(select, { target: { value: "material:paint" } });
    expect(setLayerAppearance).toHaveBeenCalledWith("L1", {
      kind: "material",
      name: "paint",
    });
    fireEvent.change(select, { target: { value: "" } });
    expect(setLayerAppearance).toHaveBeenLastCalledWith("L1", null);
  });

  it("does not let a click bubble to the row (which would re-select the layer)", () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <AppearanceSelector
          layerId="L1"
          themes={themes}
          selected={null}
          texturesResolvable
        />
      </div>,
    );
    fireEvent.click(screen.getByLabelText("Appearance"));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("explains, for a local file with a texture theme, why images cannot load", () => {
    render(
      <AppearanceSelector
        layerId="L1"
        themes={themes}
        selected={themes[0]!}
        texturesResolvable={false}
      />,
    );
    expect(screen.getByLabelText("Appearance").getAttribute("title")).toContain(
      "local file",
    );
  });
});

describe("option value round trip", () => {
  it("encodes kind and name and decodes back to the same theme", () => {
    for (const theme of themes) {
      expect(
        appearanceFromOptionValue(appearanceOptionValue(theme), themes),
      ).toEqual(theme);
    }
    expect(appearanceFromOptionValue("", themes)).toBeNull();
    expect(appearanceFromOptionValue("texture:nope", themes)).toBeNull();
  });
});
