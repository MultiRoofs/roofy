# Scene export

The workspace header's Export control offers PNG download and a scene print
preview. The preview uses the browser print dialog, where Save as PDF is
available in browsers that support it; embedded webviews may not expose native
printing.

`CitySceneHandle.captureImage` waits for Navara's `postRender` and copies the
canvas synchronously before WebGL discards its drawing buffer. The copy adds
an attribution footer using the active viewport attribution lines. It captures
the current rendered tiles, camera and styling, without sidebars or map controls.
It does not wait for further streaming tiles or produce vector geometry.

`features/export/captureFrame.ts` owns render timing and timeout cleanup;
`sceneImage.ts` composes the raster; `browserSceneExport.ts` owns download and
print-preview browser APIs. The native dialog removes its print-only stylesheet
when closed. No renderer buffer-preservation setting or runtime dependency was
added.

Validation: focused export/header/layer tests, TypeScript build check, and
browser inspection of the captured Delft scene and attribution. Native print
pagination/PDF output still needs verification in a browser with print support.
