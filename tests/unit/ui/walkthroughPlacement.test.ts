import { describe, expect, it } from "vitest";
import { placeWalkthroughCard } from "../../../src/ui/walkthrough/placement";
describe("walkthrough placement", () => {
  it("stays above a bottom drawer instead of covering its filter buttons", () => {
    const p = placeWalkthroughCard(
      { left: 266, top: 468, width: 700, height: 230 },
      { width: 320, height: 280 },
      { width: 1280, height: 720 },
    );
    expect(p.top + 280).toBeLessThan(468);
    expect(p.side).toBe("above");
  });
  it("fits beside a right panel", () => {
    const p = placeWalkthroughCard(
      { left: 960, top: 80, width: 310, height: 600 },
      { width: 320, height: 280 },
      { width: 1280, height: 720 },
    );
    expect(p.left + 320).toBeLessThan(960);
  });
  it("keeps a centred invitation inside a narrow viewport", () => {
    const p = placeWalkthroughCard(
      null,
      { width: 296, height: 350 },
      { width: 320, height: 568 },
    );
    expect(p.left).toBe(12);
    expect(p.top).toBeGreaterThanOrEqual(12);
    expect(p.top + 350).toBeLessThanOrEqual(556);
  });
});
