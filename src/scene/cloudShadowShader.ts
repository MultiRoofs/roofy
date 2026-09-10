/** Compatibility bridge for Takram's forward-lit branch. Preserve geometric
 * shadows and apply the existing cloud optical-depth sample to incoming light.
 * A 35% ambient floor approximates diffuse sky light under full cloud cover. */
export function forwardCloudShadowShader(shader: string): string {
  const branch =
    "#else // defined(SUN_LIGHT) || defined(SKY_LIGHT)\n  radiance = inputColor.rgb;";
  if (!shader.includes(branch))
    throw new Error(
      "Unsupported aerial perspective shader: cloud shadow bridge not applied.",
    );
  return shader.replace(
    branch,
    "#else // defined(SUN_LIGHT) || defined(SKY_LIGHT)\n  radiance = inputColor.rgb * mix(0.35, 1.0, sunTransmittance);",
  );
}
