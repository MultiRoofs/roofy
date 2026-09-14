import { it, expect } from "vitest";
import { prepareDrawing } from "../../../../src/features/drawing/prepareDrawing";
it("converts picked ellipsoid elevation to the renderer source datum", async () => {
  const model = await prepareDrawing(
    [
      [4, 52, 45],
      [4.001, 52, 45],
      [4, 52.001, 45],
    ],
    10,
    async () => 40,
  );
  expect(model.bbox?.[2]).toBe(5);
  expect(model.bbox?.[5]).toBe(15);
});
