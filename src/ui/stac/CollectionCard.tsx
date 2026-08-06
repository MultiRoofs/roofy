/**
 * One collection, as a card in the catalog browser's grid.
 *
 * A BUTTON, not a div with an onClick: opening a collection is the card's whole
 * purpose, and a button is the one element that is reachable by Tab, activated
 * by Enter and Space, and announced as actionable — none of which a clickable
 * div gets for free. The card's non-browsable state is therefore a real
 * `disabled`, so the keyboard cannot reach a dead end either.
 *
 * WHAT THE BADGES SAY. Only facts the catalog actually stated. `null` in this
 * vocabulary means "the collection did not say" (see `stacTypes.ts`), so a
 * feature badge is rendered on `true` alone — a missing "Textures" badge means
 * "not advertised", and printing "Textures: no" for an unknown would be a claim
 * the catalog never made. The co_type list is capped at five with a `+N`
 * because a handful of collections enumerate a few dozen and the card is 15rem
 * wide.
 */

import type { ReactElement } from "react";
import type { StacCollectionCard } from "../../features/stac/stacTypes";

export interface CollectionCardProps {
  readonly card: StacCollectionCard;
  readonly onOpen: (card: StacCollectionCard) => void;
}

/** Beyond this the badge row wraps to more lines than the card is tall. */
const MAX_CO_TYPE_BADGES = 5;

export function CollectionCard(props: CollectionCardProps): ReactElement {
  const { card, onOpen } = props;
  // The items index IS the browsability: without a parquet mirror there is no
  // item list to open, and 31 of the catalog's 53 collections are in that state.
  const browsable = card.itemsParquetHref !== null;
  const shownCoTypes = card.coTypes.slice(0, MAX_CO_TYPE_BADGES);
  const hiddenCoTypes = card.coTypes.length - shownCoTypes.length;

  return (
    <button
      type="button"
      className="stac-card"
      disabled={!browsable}
      // Redundant beside `disabled` for a browser, but it is what several
      // screen readers actually relay for a custom-styled control, and it costs
      // nothing to state both.
      aria-disabled={browsable ? undefined : true}
      onClick={() => onOpen(card)}
    >
      <span className="stac-card-title">{card.title}</span>
      {card.description !== "" && (
        <span className="stac-card-desc">{card.description}</span>
      )}
      <span className="stac-badges">
        {card.lods.map((lod) => (
          <span className="stac-badge stac-badge-lod" key={`lod-${lod}`}>
            LoD {lod}
          </span>
        ))}
        {shownCoTypes.map((type) => (
          <span className="stac-badge" key={`co-${type}`}>
            {type}
          </span>
        ))}
        {hiddenCoTypes > 0 && (
          <span className="stac-badge">+{hiddenCoTypes}</span>
        )}
        {card.semanticSurfaces === true && (
          <span className="stac-badge stac-badge-feature">
            Semantic surfaces
          </span>
        )}
        {card.textures === true && (
          <span className="stac-badge stac-badge-feature">Textures</span>
        )}
        {card.materials === true && (
          <span className="stac-badge stac-badge-feature">Materials</span>
        )}
        {card.projCodes.map((code) => (
          <span className="stac-badge" key={`proj-${code}`}>
            {code}
          </span>
        ))}
        {card.cityObjectsTotal !== null && (
          <span className="stac-badge">
            {/* Explicit "en" rather than the ambient locale: the rest of this
                app's numbers are formatted the same way, and a card that
                thousand-separates differently from the stats panel beside it
                reads as a different app. */}
            {card.cityObjectsTotal.toLocaleString("en")} objects
          </span>
        )}
      </span>
      <span className="stac-card-footer">
        {browsable ? "Browse items →" : "No items indexed"}
      </span>
    </button>
  );
}
