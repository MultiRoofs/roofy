/**
 * "What IS this layer?" — the definition rows (source, format, CRS, extent,
 * what is in it) and the per-layer knobs that used to be crammed into the
 * layer row: LoD, appearance, object-type visibility, and for a streaming
 * layer the camera-sync freeze and the resident-cache readout.
 *
 * The controls are the EXISTING ones, reused rather than reimplemented —
 * `LodSelector`, `AppearanceSelector`, `LayerTypeToggles`,
 * `StreamingLodControl` — because each carries reasoning a second copy would
 * lose (the auto/manual read-out, the local-file texture note, the
 * top-level-group fold). What changes is that they now have room for a label,
 * so a user can tell what each of them does.
 *
 * `StreamingLodControl` is GLOBAL: it drives every streaming layer, not this
 * one. Sitting among per-layer settings it has to say so, so it is passed the
 * long label rather than the row's compact one.
 *
 * Every stream subscription in this file is a single `?.` field selector, so
 * a static layer's id yields a stable `undefined` and no commit on any OTHER
 * layer's stream re-renders this section.
 */
import { useId, useState } from "react";
import {
  countRootObjectsByType,
  crsLabel,
  encodingLabel,
  extentLine,
  layerKindOf,
  truncateMiddle,
} from "../../features/layers/layerPresentation";
import { useLayerStore } from "../../features/layers/layerStore";
import { useStreamStore } from "../../features/streaming/streamStore";
import { getResidentModel } from "../../features/streaming/residentModel";
import type { CityModel } from "../../domain/citymodel/types";
import type { ActiveLayer } from "../../features/workspace/activeLayer";
import { AppearanceSelector } from "../sidebar/AppearanceSelector";
import { LodSelector } from "../sidebar/LodSelector";
import { formatCount } from "../table/tableText";
import { KIND_LABEL, sourceOf } from "./geoLayerMeta";
import {
  useHasFamilies,
  useOpenedFamilyRows,
} from "../../features/layers/familyStore";
import { LayerFamilies } from "./LayerFamilies";
import { LayerTypeToggles } from "./LayerTypeToggles";
import { CityObjectIcon } from "./CityObjectIcon";
import { StreamingLodControl } from "./StreamingLodControl";

/** Long enough to keep a host and a file name either side of the ellipsis in
 *  a 240–420 px panel, short enough not to force the column wider. */
const SOURCE_MAX = 44;

const STREAMING_LOD_LABEL =
  "Streaming level of detail (applies to every streaming layer)";

export function DetailsSection({ item }: { readonly item: ActiveLayer }) {
  const layerId = item.layer.id;

  // Always subscribed, branched on only below — see the module comment.
  const streamVersion = useStreamStore((s) => s.streams[layerId]?.version);
  const streamTypes = useStreamStore((s) => s.streams[layerId]?.types);
  const streamObjectsCount = useStreamStore(
    (s) => s.streams[layerId]?.header.objectsCount,
  );
  const streamThemes = useStreamStore(
    (s) => s.streams[layerId]?.appearanceThemes,
  );
  // The OPENED families' rows are the honest denominator for a package (the same
  // rule the status bar uses), and their presence is also what tells a
  // file-backed family table from a FlatCityBuf layer's resident one. Subscribed
  // UNCONDITIONALLY, like every other selector here: the geo branch below returns
  // early, and a hook after it would change this component's hook order.
  const openedRows = useOpenedFamilyRows(layerId);
  // Whether the table is FILE-backed, which is a property of the layer and not
  // of the current reopen: `openedRows` is null while a failed reopen has nothing
  // open, and the table is a family view either way.
  const hasFamilies = useHasFamilies(layerId);
  const setCameraSync = useLayerStore((s) => s.setCameraSync);
  const [metadataOpen, setMetadataOpen] = useState(false);
  // The SYNC/FROZEN badge is labelled by the caption beside it rather than
  // by its own two words, and the id has to be unique on the page — a fixed
  // string would collide the moment anything mounts a second copy.
  const cameraSyncId = useId();

  if (item.kind === "geo") {
    const source = sourceOf(item.layer);
    return (
      <dl className="active-layer-rows">
        <DefinitionRow label="Source" value={source} truncate />
        <DefinitionRow label="Format" value={KIND_LABEL[item.layer.kind]} />
      </dl>
    );
  }

  const layer = item.layer;
  const model = layer.model;
  const streaming = layerKindOf(item) === "streaming";
  const crs = crsLabel(model.metadata.referenceSystem);
  const source =
    layer.modelRef.type === "url"
      ? layer.modelRef.url
      : layer.modelRef.fileName;
  const resident = streaming
    ? getResidentModel(layerId, streamVersion ?? 0)
    : null;
  const total = openedRows ?? streamObjectsCount ?? null;

  return (
    <>
      <dl className="active-layer-rows">
        <DefinitionRow label="Source" value={source} truncate />
        <DefinitionRow
          label="Format"
          value={encodingLabel(model.sourceEncoding)}
        />
        <DefinitionRow label="CRS" value={crs ?? "Not stated"} />
        <DefinitionRow
          label="Extent"
          value={extentLine(model.bbox, crs) ?? "Not stated"}
        />
      </dl>

      {/* What is IN the layer. A streaming layer's objects arrive cell by
          cell, so it lists the types discovered so far rather than
          per-type counts of the resident cache read as the dataset's. */}
      <div className="active-layer-group">
        <h4 className="active-layer-group-title">Objects</h4>
        {resident && (
          // "Objects", never "buildings": a Building's parts are objects too,
          // so a building count would not add up against anything. The
          // dataset's size is given only where the stream's header states it
          // (CityParquet); a FlatCityBuf header counts features, not objects.
          // The tooltip keeps the cache's own numbers and says the loaded set
          // includes a margin around the view.
          <p
            className="active-layer-note"
            title={`Resident cache: ${resident.featureCount} ${plural(
              resident.featureCount,
              "object",
            )} loaded across ${resident.cellCount} resident ${plural(
              resident.cellCount,
              "cell",
            )}. Includes a margin around the viewport and cells not yet evicted.`}
          >
            {`Showing the objects in view — ${formatCount(resident.featureCount)}${
              total !== null ? ` of ${formatCount(total)}` : ""
            } loaded. ${
              // A FAMILY's table is a view over the FILE (ruling R-B′), so it
              // answers for rows the camera never delivered: what is partial is
              // the SCENE, not the table. A FlatCityBuf layer's table really is
              // built from the resident set, and keeps the older sentence.
              hasFamilies
                ? "The table and statistics cover the whole family, whatever is on screen."
                : "The table and statistics cover loaded objects only."
            }`}
          </p>
        )}
        {streaming ? (
          <p
            className="active-layer-note"
            title="Types are discovered cell by cell as you pan; per-type counts for the whole dataset live in the table."
          >
            {streamTypes && streamTypes.length > 0
              ? streamTypes.join(", ")
              : "Types appear as features stream in"}
          </p>
        ) : (
          <ObjectTypeCounts model={model} />
        )}
      </div>

      {/* ABOVE Object visibility, and a block of its own: a family is OPENED
          (its file is streaming, its table can be browsed either way), a type
          is VISIBLE. One block that mixed them would make "hide Bridge" and
          "close the bridge family" read as the same act. Renders nothing for
          every layer that has no families, which is all but a streamed
          CityParquet package. */}
      <LayerFamilies layerId={layerId} />

      <div className="active-layer-group active-layer-types">
        <h4 className="active-layer-group-title">Object visibility</h4>
        <LayerTypeToggles layer={layer} expanded />
      </div>

      <div className="active-layer-group">
        <h4 className="active-layer-group-title">Display</h4>
        <div className="active-layer-controls">
          {streaming ? (
            <StreamingLodControl label={STREAMING_LOD_LABEL} />
          ) : (
            layer.availableLods.length > 0 && (
              <div className="active-layer-control active-layer-control--lod">
                <span className="active-layer-control-label">
                  Level of detail
                </span>
                <LodSelector
                  layerId={layerId}
                  availableLods={layer.availableLods}
                  selectedLod={layer.selectedLod}
                  selectedLods={layer.selectedLods}
                  isStreaming={false}
                  lodMode={layer.lodMode}
                />
              </div>
            )
          )}

          {(streaming ? (streamThemes ?? []) : layer.appearanceThemes).length >
            0 && (
            <div className="active-layer-control">
              <span className="active-layer-control-label">Appearance</span>
              <AppearanceSelector
                layerId={layerId}
                themes={
                  streaming ? (streamThemes ?? []) : layer.appearanceThemes
                }
                selected={layer.selectedAppearance}
                texturesResolvable={layer.modelRef.type === "url"}
              />
            </div>
          )}

          {streaming && (
            // Per-layer, unlike the LoD above: freezing one extract while
            // panning another is the whole point of it.
            <div className="active-layer-control">
              <span className="active-layer-control-label" id={cameraSyncId}>
                Camera sync
              </span>
              <button
                type="button"
                className={`layer-sync-btn ${layer.cameraSync ? "is-on" : ""}`}
                aria-pressed={layer.cameraSync}
                aria-labelledby={cameraSyncId}
                title={
                  layer.cameraSync
                    ? "Following the camera — click to freeze this extract"
                    : "Frozen — click to follow the camera again"
                }
                onClick={() => setCameraSync(layerId, !layer.cameraSync)}
              >
                {layer.cameraSync ? "SYNC" : "FROZEN"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Closed by default: it is the file's own words, useful when a row
          above disagrees with what the user expected and noise otherwise. */}
      <div className="active-layer-group">
        <button
          type="button"
          className="active-layer-subdisclosure"
          aria-expanded={metadataOpen}
          onClick={() => setMetadataOpen((v) => !v)}
        >
          Metadata
        </button>
        {metadataOpen && (
          <pre className="active-layer-metadata">
            {JSON.stringify(model.metadata, null, 2)}
          </pre>
        )}
      </div>
    </>
  );
}

/**
 * A static layer's root objects, by type.
 *
 * ROOT objects only (`countRootObjectsByType`): a `BuildingPart` under a
 * `Building` is part of something already counted, not a second thing, and a
 * breakdown that said "1 Building, 5 BuildingParts" for one house is how a
 * user comes to believe the file is wrong.
 */
function ObjectTypeCounts({ model }: { readonly model: CityModel }) {
  const counts = countRootObjectsByType(model);
  if (counts.length === 0) {
    return <p className="active-layer-note">No objects</p>;
  }
  return (
    <dl className="active-layer-rows">
      {counts.map(({ type, count }) => (
        <div className="active-layer-row" key={type}>
          <dt className="active-layer-key city-object-label">
            <CityObjectIcon type={type} />
            {type}
          </dt>
          <dd className="active-layer-value">{formatCount(count)}</dd>
        </div>
      ))}
    </dl>
  );
}

function DefinitionRow({
  label,
  value,
  title,
  truncate = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly title?: string;
  readonly truncate?: boolean;
}) {
  return (
    <div className="active-layer-row">
      <dt className="active-layer-key">{label}</dt>
      {/* A tooltip only where it ADDS something: the full text behind a
          middle-truncated source, or a caller's own explanation. A tooltip
          repeating a row that is already fully visible is noise. */}
      <dd
        className="active-layer-value"
        title={title ?? (truncate ? value : undefined)}
      >
        {truncate ? truncateMiddle(value, SOURCE_MAX) : value}
      </dd>
    </div>
  );
}

/** Singular for exactly 1, plural otherwise — the layer row's rule, kept
 *  here because the tooltip below quotes it twice in one sentence. */
function plural(n: number, unit: string): string {
  return n === 1 ? unit : `${unit}s`;
}
