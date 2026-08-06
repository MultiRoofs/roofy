/**
 * The STAC catalog browser: pick a collection, then pick a file out of it.
 *
 * TWO VIEWS, ONE COMPONENT, on purpose. The state that survives the transition
 * — which hrefs have already been added this session — belongs to neither view
 * alone, and the "back" arrow is a state change rather than a route. Splitting
 * it would mean lifting that state into a parent that has nothing else to do.
 *
 * WHAT IS CACHED WHERE. Nothing fetched is held here: both the collection crawl
 * and each collection's item index live in `useStacStore`, so closing and
 * reopening the dialog is instant (see that module's header for why). What IS
 * local is everything about the current LOOK at the catalog — filters,
 * selection, hover, the map's viewport — because none of it is worth restoring
 * and all of it is stale the moment the user opens a different collection.
 *
 * THE VIEWPORT FILTER NARROWS THE LIST, NEVER THE MAP. The map always draws
 * every footprint the collection has: it is the thing being panned, and a map
 * that erased the rectangles the user is panning TOWARDS would be unusable.
 * Items with no footprint at all stay listed unconditionally — a bbox-less item
 * cannot be judged against a viewport, and dropping it would make it
 * unreachable rather than merely unmapped.
 *
 * ADDING DOES NOT CLOSE ANYTHING. `onAddUrl` funnels into the app's one URL
 * loading path and the browser stays exactly where it was, because picking
 * several tiles out of one collection is the normal case, not the exception.
 * Whether the surrounding dialog closes is the dialog's business, not this
 * component's.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { classifyStacAsset } from "../../features/stac/stacAssets";
import { bboxIntersectsBounds } from "../../features/stac/stacGeo";
import { useStacStore } from "../../features/stac/stacStore";
import type {
  StacAssetInfo,
  StacCollectionCard,
  StacItemRecord,
} from "../../features/stac/stacTypes";
import { CollectionCard } from "./CollectionCard";
import { StacItemMap } from "./StacItemMap";

export interface StacBrowserProps {
  /** Funnel into the app's URL loading path (App.handleUrl / dialog onAddUrl). */
  readonly onAddUrl: (url: string) => void;
}

/**
 * How many item rows are ever in the DOM at once.
 *
 * The largest collection in this catalog indexes tens of thousands of items and
 * every row is a real button; rendering all of them locks the main thread for
 * seconds inside a modal. The cap is paired with a visible note rather than
 * silent truncation, and the filter above it is the way past it — which is also
 * why it is a cap and not a virtual list: the user is looking for ONE tile, and
 * "type three characters" gets there faster than any amount of scrolling.
 */
export const ITEM_LIST_RENDER_CAP = 300;

type ViewBounds = [[number, number], [number, number]];

/** A stable empty array, so a collection whose entry has not arrived yet does
 *  not hand `StacItemMap` a fresh `[]` on every render — its `setData` effect
 *  keys on the array's IDENTITY. */
const NO_ITEMS: readonly StacItemRecord[] = [];

interface RenderRow {
  readonly item: StacItemRecord;
  readonly info: StacAssetInfo;
}

export function StacBrowser(props: StacBrowserProps): ReactElement {
  const { onAddUrl } = props;

  const collectionsStatus = useStacStore((s) => s.collectionsStatus);
  const collectionsError = useStacStore((s) => s.collectionsError);
  const collections = useStacStore((s) => s.collections);
  const itemsByCollection = useStacStore((s) => s.itemsByCollection);
  const loadCollections = useStacStore((s) => s.loadCollections);
  const retryCollections = useStacStore((s) => s.retryCollections);
  const loadItems = useStacStore((s) => s.loadItems);

  const [openCard, setOpenCard] = useState<StacCollectionCard | null>(null);
  const [collectionFilter, setCollectionFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // PLAIN STATE, not a ref: the map calls `onHover` on every mousemove and the
  // list has to repaint the matching row, which only a render does. The row
  // set it repaints is memoised below and does NOT depend on hover, so a
  // mousemove re-renders rows without re-filtering or re-classifying them.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [addedHrefs, setAddedHrefs] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [viewportOnly, setViewportOnly] = useState(true);
  const [viewBounds, setViewBounds] = useState<ViewBounds | null>(null);

  // The store suppresses a repeat crawl itself, so calling this on every mount
  // is both safe and the recovery path: a browser reopened after a failure
  // re-crawls, because `error` is the one status the guard lets through.
  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    if (openCard !== null) loadItems(openCard);
  }, [openCard, loadItems]);

  const entry = openCard === null ? undefined : itemsByCollection[openCard.id];
  const allItems = entry?.items ?? NO_ITEMS;

  const openCollection = useCallback((card: StacCollectionCard): void => {
    setOpenCard(card);
    // Every "look at the catalog" value belongs to the collection being looked
    // at. Carrying the previous one's viewport across is the worst of them: the
    // filter would hide every item until the map's first `moveend` replaced it.
    setItemFilter("");
    setSelectedId(null);
    setHoveredId(null);
    setViewBounds(null);
  }, []);

  const backToCollections = useCallback((): void => {
    setOpenCard(null);
    setSelectedId(null);
    setHoveredId(null);
    setViewBounds(null);
  }, []);

  const addHref = useCallback(
    (href: string): void => {
      // Guarded as well as disabled: the button below cannot be clicked twice,
      // but "already added" is a fact about the session, not about one button.
      if (addedHrefs.has(href)) return;
      setAddedHrefs((prev) => {
        const next = new Set(prev);
        next.add(href);
        return next;
      });
      onAddUrl(href);
    },
    [addedHrefs, onAddUrl],
  );

  // ---- collections view -----------------------------------------------------

  const filteredCollections = useMemo(() => {
    const needle = collectionFilter.trim().toLowerCase();
    if (needle === "") return collections;
    return collections.filter(
      (c) =>
        c.title.toLowerCase().includes(needle) ||
        c.description.toLowerCase().includes(needle),
    );
  }, [collections, collectionFilter]);

  // ---- items view -----------------------------------------------------------

  /**
   * The rows the list will render: filtered, viewport-narrowed, capped, and
   * with their asset already classified.
   *
   * Classification lives HERE rather than in the row markup because
   * `classifyStacAsset` parses a URL, and doing that 300 times per mousemove
   * (the map hovers on every one) is exactly the kind of cost a memo exists to
   * keep off the pointer path. Hover is deliberately not a dependency.
   */
  const { rows, total } = useMemo((): {
    rows: readonly RenderRow[];
    total: number;
  } => {
    const needle = itemFilter.trim().toLowerCase();
    const bounds = viewportOnly ? viewBounds : null;
    const matched = allItems.filter((it) => {
      if (needle !== "" && !it.id.toLowerCase().includes(needle)) return false;
      // A footprint-less item cannot be judged against a viewport, so it is
      // never judged: it stays listed, which is the only way it stays
      // reachable.
      if (bounds !== null && it.bbox2d !== null) {
        return bboxIntersectsBounds(it.bbox2d, bounds);
      }
      return true;
    });
    return {
      rows: matched.slice(0, ITEM_LIST_RENDER_CAP).map((item) => ({
        item,
        info: classifyStacAsset(item.assetHref, item.assetType),
      })),
      total: matched.length,
    };
  }, [allItems, itemFilter, viewportOnly, viewBounds]);

  const selected = useMemo((): RenderRow | null => {
    if (selectedId === null) return null;
    // Searched in the FULL list, not in `rows`: the map can select an item the
    // filter has hidden, and the detail strip is what tells the user what they
    // just clicked.
    const item = allItems.find((it) => it.id === selectedId);
    if (item === undefined) return null;
    return { item, info: classifyStacAsset(item.assetHref, item.assetType) };
  }, [allItems, selectedId]);

  if (openCard === null) {
    return (
      <div className="stac-browser">
        <input
          className="stac-search"
          placeholder="Filter collections…"
          aria-label="Filter collections"
          value={collectionFilter}
          onChange={(e) => setCollectionFilter(e.target.value)}
        />
        {(collectionsStatus === "idle" || collectionsStatus === "loading") && (
          <p className="stac-status">Loading catalog…</p>
        )}
        {collectionsStatus === "error" && (
          <p className="stac-status" role="alert">
            {collectionsError ?? "Could not reach the catalog."}{" "}
            <button
              type="button"
              className="stac-retry"
              onClick={retryCollections}
            >
              Retry
            </button>
          </p>
        )}
        {collectionsStatus === "ready" && collections.length === 0 && (
          <p className="stac-status">No collections found.</p>
        )}
        <div className="stac-card-grid">
          {filteredCollections.map((card) => (
            <CollectionCard key={card.id} card={card} onOpen={openCollection} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="stac-browser">
      <div className="stac-items-header">
        <button type="button" className="stac-back" onClick={backToCollections}>
          ← Collections
        </button>
        <span className="stac-items-title">{openCard.title}</span>
      </div>

      {(entry === undefined || entry.status === "loading") && (
        <p className="stac-status">Loading items…</p>
      )}
      {entry?.status === "error" && (
        <p className="stac-status" role="alert">
          {entry.error ?? "Could not read this collection's items."}{" "}
          <button
            type="button"
            className="stac-retry"
            onClick={() => loadItems(openCard)}
          >
            Retry
          </button>
        </p>
      )}
      {entry?.status === "ready" && entry.items.length === 0 && (
        <p className="stac-status">
          No items in this collection&rsquo;s index.
        </p>
      )}

      <div className="stac-items">
        <div className="stac-item-column">
          <input
            className="stac-search"
            placeholder="Filter items…"
            aria-label="Filter items"
            value={itemFilter}
            onChange={(e) => setItemFilter(e.target.value)}
          />
          <label className="stac-viewport-toggle">
            <input
              type="checkbox"
              checked={viewportOnly}
              onChange={(e) => setViewportOnly(e.target.checked)}
            />
            Only items in map view
          </label>

          <div className="stac-item-list">
            {rows.map(({ item, info }) => {
              const href = item.assetHref;
              const added = href !== null && addedHrefs.has(href);
              const isSelected = item.id === selectedId;
              const className = [
                "stac-item-row",
                isSelected ? "is-selected" : "",
                item.id === hoveredId ? "is-hovered" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={item.id}
                  className={className}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* The row and its Add button are SIBLINGS, not nested: a
                      button inside a button is invalid HTML, and browsers
                      resolve it by dropping one of the two click targets. */}
                  <button
                    type="button"
                    className="stac-item-row-main"
                    data-testid="stac-item-row"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedId(item.id)}
                    // Keyboard parity with the wrapper's mouseenter: tabbing
                    // through the list highlights the same rectangle on the map
                    // that hovering would.
                    onFocus={() => setHoveredId(item.id)}
                    onBlur={() => setHoveredId(null)}
                  >
                    <span className="stac-item-id">{item.id}</span>
                    <span className="stac-item-meta">
                      {info.label}
                      {item.lods.length > 0 && ` · LoD ${item.lods.join(", ")}`}
                      {item.cityObjects !== null &&
                        ` · ${item.cityObjects.toLocaleString("en")} objects`}
                    </span>
                  </button>
                  {info.loadable && href !== null && (
                    <button
                      type="button"
                      className="stac-add-btn stac-add-btn--inline"
                      disabled={added}
                      // The visible word is "Add"; the item it adds is only
                      // clear from the row beside it, which a screen reader
                      // does not read as one unit. The label supplies it.
                      aria-label={
                        added ? `Added ${item.id}` : `Add ${item.id} to scene`
                      }
                      onClick={() => addHref(href)}
                    >
                      {added ? "Added ✓" : "Add"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {total > rows.length && (
            <p className="stac-cap-note">
              Showing first {ITEM_LIST_RENDER_CAP} of {total} items — refine the
              filter
            </p>
          )}

          {selected !== null && (
            <div className="stac-item-detail">
              <span className="stac-item-id">{selected.item.id}</span>
              <span className="stac-badge">{selected.info.label}</span>
              {selected.item.assetHref === null ? (
                <span className="stac-status">No data asset</span>
              ) : selected.info.loadable ? (
                <button
                  type="button"
                  className="stac-add-btn"
                  disabled={addedHrefs.has(selected.item.assetHref)}
                  onClick={() => {
                    if (selected.item.assetHref !== null) {
                      addHref(selected.item.assetHref);
                    }
                  }}
                >
                  {addedHrefs.has(selected.item.assetHref)
                    ? "Added ✓"
                    : "Add to scene"}
                </button>
              ) : (
                <a
                  className="stac-download-link"
                  href={selected.item.assetHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Download ({selected.info.label})
                </a>
              )}
            </div>
          )}
        </div>

        <StacItemMap
          // EVERY footprint, never the filtered list — see the header.
          items={allItems}
          selectedId={selectedId}
          hoveredId={hoveredId}
          onSelect={setSelectedId}
          onHover={setHoveredId}
          fallbackExtent={openCard.extent2d}
          onViewBounds={setViewBounds}
        />
      </div>
    </div>
  );
}
