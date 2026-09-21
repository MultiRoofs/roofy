# Drawing on the map

The scene consists of a toolbar row followed by the map viewport. The toolbar contains a grouped Mode selector, place search, Sun & shade, and Scene settings. Future layer analysis tools can join this toolbar without entering the workspace header.

Add layer → Draw creates an empty draft layer. With that draw layer selected, Mode → Draw model starts a footprint. Pick feature and Pick surface are alternatives in the same selector; selection is disabled during drawing, and switching layers exits drawing. Click the first corner or Finish footprint to close it, then move the pointer vertically to preview extrusion and click to finish. A numeric height field is available; Finish as 2D creates a flat polygon. Escape or Cancel exits the sketch. Completed shapes become ordinary city-model layers.

Footprints are limited to 64 corners, must not self-intersect, and use one base elevation (the first picked surface). Heights range from 0 to 1,000 metres. The preview is a projected outline; final geometry is rendered by the city-model plugin. Pointer extrusion uses 0.5 metres per screen pixel; use the numeric field for precise heights.

Picked positions use WGS84 ellipsoid elevation. Geometry is stored in EPSG:3857 with source elevation corrected by the same geoid service used by city-model placement. Web Mercator coordinates are suitable for placement but horizontal distances/areas inherit Mercator scale distortion. This is a sketching tool, not survey geometry. Polar latitudes beyond ±85° are rejected.

Completed drawings carry an inline CityJSON data URL, including roof/wall/ground semantics, so they can use the workspace save/restore path without a local source file. Large share links remain subject to the existing share-size limit. An unfinished draft is not a completed model and is discarded on workspace replacement.

# Forward-lit cloud shadows

Navara 0.1.1 computes atmospheric cloud shadow optical depth, but the upstream forward-lighting branch ignores it. `cloudShadowShader.ts` patches that branch locally to attenuate incoming light, retaining a 35% ambient floor. The normal geometry lighting continues to supply building shadows. This requires post-processing, aerial perspective, clouds and sun shadows to be enabled. The bridge rejects an unknown upstream shader rather than silently changing an unrelated expression; review it when upgrading the renderer.
