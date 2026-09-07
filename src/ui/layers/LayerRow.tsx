/**
 * One row of the layer list — the same row for every kind of layer.
 *
 * The incumbent had two: a dense city row carrying a LoD select, an
 * appearance select, a type-toggle disclosure and three action buttons, and a
 * smaller geospatial one carrying a subset. Nothing about "which store is
 * this in" is a question the reader has, so there is now ONE row, and what
 * differs between kinds is said in words: a type icon and a STATE LINE under
 * the name (`layerStateLine`, Task 16). The per-layer configuration the city
 * row used to wear moved to the active layer's own panel (12.3), where there
 * is room to lay it out as a form.
 *
 * STORE-FREE on purpose. The row takes the layer, its state line and a set of
 * callbacks; `LayerList` is the only thing that reads a store, so this row can
 * be rendered — and reasoned about — without four of them being seeded.
 *
 * The eye stays on the face of the row because visibility is toggled
 * constantly; everything else is behind the `⋯` (see `LayerRowMenu`).
 */
import { useRef, useState, type ReactNode } from "react";
import type { ActiveLayer } from "../../features/workspace/activeLayer";
import {
  layerStateLine,
  type LayerKind,
} from "../../features/layers/layerPresentation";
import { VisibilityIcon } from "./VisibilityIcon";
import { LayerRowMenu } from "./LayerRowMenu";

export interface LayerRowProps {
  readonly item: ActiveLayer;
  readonly active: boolean;
  /** From `layerStateLine`. The row never composes this itself: the sentence
   *  is the one place a layer's kind, count and trouble are worded, and two
   *  places wording it is two places to drift. */
  readonly stateLine: string;
  readonly kind: LayerKind;
  /** The end of the state line. 12.4 fills it with the active filter; `null`
   *  until then. */
  readonly filterChip: ReactNode | null;
  readonly onActivate: () => void;
  readonly onToggleVisible: () => void;
  /** Called with the TRIMMED new name, only when it is non-empty. */
  readonly onRename: (name: string) => void;
  /** `null` for a row with no extent to fly to — an XYZ raster names none,
   *  and a geo layer waiting for its file has nothing to walk yet. */
  readonly onZoom: (() => void) | null;
  readonly onOpenTable: (() => void) | null;
  readonly onRemove: () => void;
  /** Vector kind only: true while the layer's data has not survived a
   *  reload (`isGeoLayerUnavailable`) — gates the face Re-link/Remove pair
   *  below, the same pair `PlaceholderRow`'s "unavailable" kind offers for a
   *  file-backed city model with no store entry at all. A geo layer keeps
   *  its store row through this state, so it gets the pair on the ROW
   *  itself rather than a placeholder swapped in for it. */
  readonly unavailable?: boolean;
  /** Vector kind only, paired with `unavailable`. Same shape as
   *  `PlaceholderRow.onRelink`: a raw `File`, so the caller (which already
   *  reads a store) owns the parse and the write. */
  readonly onRelink?: (file: File) => void;
}

export function LayerRow({
  item,
  active,
  stateLine,
  kind,
  filterChip,
  onActivate,
  onToggleVisible,
  onRename,
  onZoom,
  onOpenTable,
  onRemove,
  unavailable,
  onRelink,
}: LayerRowProps) {
  const { name, visible } = item.layer;
  const rowRef = useRef<HTMLDivElement>(null);
  const relinkInputRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  // A REF beside the state, read synchronously inside one event: ending the
  // edit hands the focus back to the row, which blurs the field, whose own
  // handler ends the edit again — and `renaming` is still `true` in that
  // second closure, so a state read cannot stop the double commit.
  const editing = useRef(false);

  const startRename = () => {
    setDraft(name);
    editing.current = true;
    setRenaming(true);
  };

  /**
   * End the edit, keeping it or not, and put the focus back on the row.
   *
   * The field unmounts here. A control that unmounts with the focus inside it
   * strands the ring on `<body>` and the keyboard user loses their place in
   * the list — the same rule `useHeaderMenu` holds for a dismissed popover.
   */
  const endRename = (keep: boolean) => {
    if (!editing.current) return;
    editing.current = false;
    if (keep) {
      const trimmed = draft.trim();
      if (trimmed !== "" && trimmed !== name) onRename(trimmed);
    }
    setRenaming(false);
    rowRef.current?.focus();
  };

  return (
    <div
      ref={rowRef}
      role="listitem"
      className={[
        "layer-row",
        active ? "layer-row-active" : "",
        visible ? "" : "layer-row-hidden",
      ]
        .filter(Boolean)
        .join(" ")}
      // `aria-current` rather than `aria-selected`: the list is not a
      // single-select widget, it is a set of things one of which is the one
      // every other panel is describing.
      aria-current={active ? "true" : undefined}
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        // Only the ROW's own Enter. The eye, the `⋯` and the rename field are
        // all inside it, and their Enter bubbles here — activating the layer
        // behind a button press the user aimed somewhere else.
        if (e.key !== "Enter" || e.target !== e.currentTarget) return;
        onActivate();
      }}
    >
      <button
        type="button"
        className="layer-row-eye"
        // Named for what the click will DO, not for the state it shows — and
        // named after the LAYER, because five rows of "Hide layer" tell a
        // screen-reader user nothing about which one they are on.
        aria-label={visible ? `Hide ${name}` : `Show ${name}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleVisible();
        }}
      >
        <VisibilityIcon visible={visible} />
      </button>

      <span className="layer-row-kind" aria-hidden>
        <LayerKindIcon kind={kind} />
      </span>

      <span className="layer-row-body">
        {renaming ? (
          <input
            className="layer-row-name-input"
            aria-label="Layer name"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => endRename(true)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                endRename(true);
                return;
              }
              if (e.key !== "Escape") return;
              // Escape belongs to the edit in progress: the row menu's own
              // document listener would otherwise take it, and the app's
              // "Escape clears the selection" would take what was left.
              e.stopPropagation();
              endRename(false);
            }}
          />
        ) : (
          <span
            className="layer-row-name"
            title={`${name} — double-click to rename`}
            onDoubleClick={(e) => {
              e.stopPropagation();
              startRename();
            }}
          >
            {name}
          </span>
        )}
        <span className="layer-row-state">
          <span className="layer-row-state-line">{stateLine}</span>
          {filterChip}
        </span>
      </span>

      {kind === "vector" && unavailable && onRelink && (
        <>
          {/* Same shape as `PlaceholderRow`'s pair: a button that clicks a
              hidden input (a `<label>` is not a tab stop), plus a Remove
              beside it — this row still has a store entry (unlike a
              placeholder), so Remove is `removeGeoLayer`, not a local
              dismiss. Both stop propagation: the row's own `onClick`
              activates the layer, which a click aimed at either button did
              not ask for. */}
          <button
            type="button"
            className="layer-row-link-btn"
            aria-label={`Re-link ${name}`}
            onClick={(e) => {
              e.stopPropagation();
              relinkInputRef.current?.click();
            }}
          >
            Re-link
          </button>
          <input
            ref={relinkInputRef}
            type="file"
            accept=".geojson,.json"
            data-testid="relink-input"
            hidden
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so re-picking the SAME file after a parse failure
              // fires `change` again.
              e.target.value = "";
              if (file) onRelink(file);
            }}
          />
          <button
            type="button"
            className="layer-row-link-btn layer-row-dismiss"
            aria-label={`Remove ${name}`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            Remove
          </button>
        </>
      )}

      <LayerRowMenu
        name={name}
        onZoom={onZoom}
        onOpenTable={onOpenTable}
        onStartRename={startRename}
        onRemove={onRemove}
      />
    </div>
  );
}

/**
 * A row for something the layer stores know nothing about.
 *
 * Three states, one shape: a snapshot-restored layer whose local file is gone
 * ("Needs re-link"), an add still parsing ("Loading…") and an add that failed
 * ("Error · …"). The last is the reason this component exists at all — a
 * failed drop used to leave the list exactly as it was, so the only evidence
 * of it was a banner that timed out.
 *
 * NOT activatable, in every sense: no `aria-current`, no tab stop and no click
 * handler. There is no layer behind these rows for the style panel, the
 * legend or the highlight to describe, so offering the affordance would only
 * promise something nothing can deliver.
 */
export type PlaceholderKind = "unavailable" | "loading" | "error";

export interface PlaceholderRowProps {
  readonly kind: PlaceholderKind;
  readonly name: string;
  /** The failure's own sentence, for `kind: "error"`. */
  readonly message?: string;
  readonly onRelink?: (file: File) => void;
  readonly onRetry?: () => void;
  readonly onDismiss?: () => void;
}

export function PlaceholderRow({
  kind,
  name,
  message,
  onRelink,
  onRetry,
  onDismiss,
}: PlaceholderRowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Through `layerStateLine` rather than three literals, so these rows cannot
  // drift from the ones the store rows show. The `kind: "city"` is never read
  // for the first two: `error` and `unavailable` short-circuit ahead of it,
  // and a city input with no counts is exactly "Loading…".
  const stateLine = layerStateLine(
    kind === "error"
      ? { kind: "city", error: message ?? "" }
      : kind === "unavailable"
        ? { kind: "city", unavailable: true }
        : { kind: "city" },
  );

  return (
    <div role="listitem" className={`layer-row layer-row-${kind}`}>
      <span className="layer-row-kind" aria-hidden>
        <PlaceholderIcon kind={kind} />
      </span>
      <span className="layer-row-body">
        <span className="layer-row-name">{name}</span>
        <span className="layer-row-state">
          <span className="layer-row-state-line">{stateLine}</span>
        </span>
      </span>
      {kind === "unavailable" && onRelink && (
        <>
          {/* A BUTTON that clicks the input, not a `<label>` wrapping it: a
              label is not a tab stop, and re-linking would be the one action
              in this list a keyboard could not reach. */}
          <button
            type="button"
            className="layer-row-link-btn"
            aria-label={`Re-link ${name}`}
            onClick={() => fileInputRef.current?.click()}
          >
            Re-link
          </button>
          <input
            ref={fileInputRef}
            type="file"
            data-testid="relink-input"
            // Deliberately unlabelled: a hidden input cannot be reached, and
            // the button above carries the name (the same shape
            // `SourcePicker`'s browse control uses).
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Cleared so re-picking the SAME file fires `change` again.
              e.target.value = "";
              if (file) onRelink(file);
            }}
          />
        </>
      )}
      {kind === "error" && onRetry && (
        <button
          type="button"
          className="layer-row-link-btn"
          aria-label={`Retry ${name}`}
          onClick={onRetry}
        >
          Retry
        </button>
      )}
      {onDismiss && kind !== "loading" && (
        <button
          type="button"
          className="layer-row-link-btn layer-row-dismiss"
          aria-label={`Dismiss ${name}`}
          onClick={onDismiss}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}

/**
 * One glyph per {@link LayerKind}, drawn inline like every other icon in the
 * app (`VisibilityIcon`, `TrashIcon`, the header's carets): the set is small,
 * it must inherit `currentColor` to follow the row's ink, and a sprite or an
 * icon package for five paths would cost more than it saves.
 *
 * EXPORTED for `LeftRail`, which shows the active layer's kind in the 40px
 * the collapsed panel has left: the rail and the row must agree about what a
 * streaming layer looks like, and two hand-drawn broadcast glyphs would not.
 */
export function LayerKindIcon({ kind }: { readonly kind: LayerKind }) {
  switch (kind) {
    case "city":
      return (
        <svg viewBox="0 0 24 24" className="layer-kind-icon">
          <path d="M4 20V9l8-5 8 5v11" />
          <path d="M9.5 20v-6h5v6" />
        </svg>
      );
    case "streaming":
      // Broadcast arcs: a layer whose content arrives as the camera moves.
      return (
        <svg viewBox="0 0 24 24" className="layer-kind-icon">
          <path d="M4.5 11a10.5 10.5 0 0 1 15 0" />
          <path d="M8 14.5a5.5 5.5 0 0 1 8 0" />
          <circle cx="12" cy="18.5" r="1.2" />
        </svg>
      );
    case "vector":
      return (
        <svg viewBox="0 0 24 24" className="layer-kind-icon">
          <path d="M5.5 6.5 18 9.5l-2.5 8-9-2.5z" />
          <circle cx="5.5" cy="6.5" r="1.4" />
          <circle cx="18" cy="9.5" r="1.4" />
        </svg>
      );
    case "raster":
      return (
        <svg viewBox="0 0 24 24" className="layer-kind-icon">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M4 12h16M12 4v16" />
        </svg>
      );
    case "tiles":
      return (
        <svg viewBox="0 0 24 24" className="layer-kind-icon">
          <path d="M12 3.5 4 8v8l8 4.5 8-4.5V8z" />
          <path d="m4 8 8 4.5L20 8M12 12.5V20.5" />
        </svg>
      );
  }
}

function PlaceholderIcon({ kind }: { readonly kind: PlaceholderKind }) {
  switch (kind) {
    case "loading":
      return (
        <svg viewBox="0 0 24 24" className="layer-kind-icon layer-kind-spin">
          <path d="M12 4a8 8 0 1 0 8 8" />
        </svg>
      );
    case "error":
      return (
        <svg viewBox="0 0 24 24" className="layer-kind-icon">
          <path d="M12 4 21 19H3z" />
          <path d="M12 10v4M12 17h.01" />
        </svg>
      );
    case "unavailable":
      // A broken link: the file the layer was made from is no longer reachable.
      return (
        <svg viewBox="0 0 24 24" className="layer-kind-icon">
          <path d="M9.5 14.5 7 17a3.5 3.5 0 0 1-5-5l2.5-2.5" />
          <path d="M14.5 9.5 17 7a3.5 3.5 0 0 1 5 5l-2.5 2.5" />
          <path d="M4 4l16 16" />
        </svg>
      );
  }
}
