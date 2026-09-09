import { useLayerStore } from "../../features/layers/layerStore";
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
  return (
    <AttributesSection
      key={`${layerId}:${objectType}`}
      attributes={attributes}
      order={order}
      onOrderChange={(next) =>
        useLayerStore.getState().setAttributeOrder(layerId, objectType, next)
      }
    />
  );
}
