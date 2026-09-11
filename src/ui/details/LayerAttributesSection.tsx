/**
 * The Details panel's attribute list for a subject that belongs to a LAYER —
 * which is what makes two layer-scoped facts available here: the per-type
 * attribute order, and the provenance registry.
 *
 * Spec §8 splits the list by PROVENANCE: the file's own attributes stay under
 * Attributes (reorderable, searchable), and the columns a tool computed for
 * THIS layer move into a COMPUTED group with the badge and the provenance
 * tooltip. The split is the registry's answer and never a guess from the key's
 * name — a file may carry an `extent_height_m` of its own, and it has to keep
 * reading as the file's value.
 */
import { useLayerStore } from "../../features/layers/layerStore";
import {
  formatProvenance,
  useComputedColumnStore,
} from "../../insights/computedColumns";
import { ComputedAttributeBadge } from "../table/ComputedAttributeBadge";
import { AttrRow } from "../inspector/attrDisplay";
import { formatValue } from "../inspector/formatAttrValue";
import { AttributesSection } from "./AttributesSection";

export function LayerAttributesSection({
  layerId,
  objectType,
  attributes,
}: {
  readonly layerId: string;
  readonly objectType: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}) {
  const order = useLayerStore((state) => {
    const orders = state.layers.find(
      (layer) => layer.id === layerId,
    )?.attributeOrders;
    return orders && Object.hasOwn(orders, objectType)
      ? orders[objectType]
      : undefined;
  });
  // The store's own object, not `computedColumnsOf`: that builds a fresh Set
  // per call, which as a selector snapshot would re-render forever.
  const computed = useComputedColumnStore((state) => state.byLayer[layerId]);
  const computedKeys = Object.keys(attributes).filter(
    (key) => computed?.[key] !== undefined,
  );
  const fileAttributes =
    computedKeys.length === 0
      ? attributes
      : Object.fromEntries(
          Object.entries(attributes).filter(
            ([key]) => computed?.[key] === undefined,
          ),
        );
  return (
    <AttributesSection
      key={`${layerId}:${objectType}`}
      attributes={fileAttributes}
      order={order}
      onOrderChange={(next) =>
        useLayerStore.getState().setAttributeOrder(layerId, objectType, next)
      }
      trailing={
        computedKeys.length === 0 ? null : (
          <div role="group" aria-label="Computed attributes">
            <h4 className="details-section-title details-computed-title">
              COMPUTED
            </h4>
            {computedKeys.map((key) => (
              <AttrRow
                key={key}
                label={key}
                value={formatValue(attributes[key])}
                badge={
                  <ComputedAttributeBadge
                    title={formatProvenance(computed![key]!)}
                  />
                }
              />
            ))}
          </div>
        )
      }
    />
  );
}
