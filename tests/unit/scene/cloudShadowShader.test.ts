import { it, expect } from "vitest";
import { forwardCloudShadowShader } from "../../../src/scene/cloudShadowShader";
it("attenuates only the forward-lit branch and refuses unknown shader versions", () => {
  const shader =
    "a\n#else // defined(SUN_LIGHT) || defined(SKY_LIGHT)\n  radiance = inputColor.rgb;\n#endif // defined(SUN_LIGHT) || defined(SKY_LIGHT)";
  expect(forwardCloudShadowShader(shader)).toContain("sunTransmittance");
  expect(() => forwardCloudShadowShader("changed")).toThrow();
});
