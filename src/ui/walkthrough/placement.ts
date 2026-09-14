export interface WalkthroughRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function placeWalkthroughCard(
  target: WalkthroughRect | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  const gap = 16;
  let left = (viewport.width - card.width) / 2;
  let top = (viewport.height - card.height) / 2;
  let side: "right" | "left" | "below" | "above" | "inside" | "center" =
    "center";
  if (target) {
    if (target.left + target.width + card.width + gap + 12 <= viewport.width) {
      left = target.left + target.width + gap;
      top = target.top;
      side = "right";
    } else if (target.left >= card.width + gap + 12) {
      left = target.left - card.width - gap;
      top = target.top;
      side = "left";
    } else if (
      target.top + target.height + card.height + gap + 12 <=
      viewport.height
    ) {
      left = target.left;
      top = target.top + target.height + gap;
      side = "below";
    } else if (target.top >= card.height + gap + 12) {
      left = target.left;
      top = target.top - card.height - gap;
      side = "above";
    } else {
      // A map spanning almost the whole viewport has no outside space.
      left = target.left + 12;
      top = viewport.height - card.height - 24;
      side = "inside";
    }
  }
  return {
    left: Math.max(12, Math.min(left, viewport.width - card.width - 12)),
    top: Math.max(12, Math.min(top, viewport.height - card.height - 12)),
    side,
  };
}
