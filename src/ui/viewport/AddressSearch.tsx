/**
 * Search for a place and fly there.
 *
 * A SCENE overlay, top-left of the canvas — where every web map puts its
 * search, and the one free corner: the scene panels are top-right, the
 * legend and scale bottom-left, the compass bottom-right. It was in the
 * toolbar until 2026-08-06, which put "where am I looking?" in the chrome
 * rather than on the map it answers about.
 *
 * A collapsed magnifier that expands into a combobox, so the resting state
 * costs the scene one button rather than a permanently open text field over
 * the imagery.
 *
 * KNOWS NO ENGINE. It is handed the viewport's `flyTo` — the same callback the
 * scene handle exposes, reaching it exactly as the compass cluster reaches
 * `zoomIn` — and it decides only WHERE to go, never at what angle: the active
 * view mode owns the orientation, so a 2D plan view is not tilted back to an
 * oblique just because someone searched for a street.
 *
 * The ARIA is the full combobox pattern (input `role="combobox"` +
 * `aria-expanded` + `aria-activedescendant`, a `role="listbox"` of
 * `role="option"`s) rather than a div with click handlers: the arrow keys are
 * how this control is used at all without a mouse, and a screen reader has to
 * be told the list appeared.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  PHOTON_ATTRIBUTION,
  type GeocodeResult,
} from "../../features/geocode/photon";
import { useAddressSearch } from "../../features/geocode/useAddressSearch";
import {
  cameraHeightForExtent,
  type FlyToTarget,
} from "../../scene/geographicCamera";

import { useSceneSheetStore } from "../../features/sceneSheet/sceneSheetStore";

export interface AddressSearchProps {
  /** Fly the camera to a point. REQUIRED, unlike in the toolbar it came from:
   *  this renders inside the viewport, so there is always an engine — and a
   *  search box that silently does nothing is worse than a type error. */
  readonly onFlyTo: (target: FlyToTarget, durationMs?: number) => void;
}

export function AddressSearch({ onFlyTo }: AddressSearchProps) {
  const [expanded, setExpanded] = useState(false);
  const sheet = useSceneSheetStore((state) => state.sheet);
  const setSheet = useSceneSheetStore((state) => state.setSheet);
  useEffect(() => {
    if (sheet !== null) {
      setExpanded(false);
      setOpen(false);
      setActiveIndex(-1);
    }
  }, [sheet]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!expanded && restoreFocus.current) {
      rootRef.current
        ?.querySelector<HTMLButtonElement>(".address-search-toggle")
        ?.focus();
      restoreFocus.current = false;
    }
  }, [expanded]);
  const collapse = () => {
    restoreFocus.current = true;
    setExpanded(false);
    setOpen(false);
    setActiveIndex(-1);
  };

  const { results, loading, error } = useAddressSearch(query);

  // Any new answer invalidates the highlight: the row that was under it is not
  // the row that is there now.
  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  // Click-outside closes the dropdown. `mousedown`, not `click`: a click that
  // starts inside the list and ends outside it (a drag over a long label) must
  // not be read as "the user went elsewhere".
  useEffect(() => {
    if (!expanded) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [expanded]);

  const select = useCallback(
    (result: GeocodeResult) => {
      // No duration: how long a search flight takes is the viewport's to
      // decide, and one constant beats two that can drift apart.
      onFlyTo({
        lng: result.lng,
        lat: result.lat,
        heightM: cameraHeightForExtent(result.extent),
      });
      // Leave the chosen label in the box — it is the answer to "where am I
      // looking?" — but close the list: the flight has started.
      setQuery(result.label);
      setOpen(false);
      setActiveIndex(-1);
    },
    [onFlyTo],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (open) {
        setOpen(false);
        // The options are gone, so the highlight (and the
        // aria-activedescendant it drives) must go with them.
        setActiveIndex(-1);
      } else collapse();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => {
        const next = index + step;
        // Wrap: a list this short is faster to cycle than to reverse out of.
        if (next < 0) return results.length - 1;
        if (next >= results.length) return 0;
        return next;
      });
      return;
    }
    if (event.key === "Enter") {
      // Inert while the list is collapsed: Enter acts on what the user can
      // SEE, and after Escape that is nothing.
      if (!open) return;
      // No highlight yet means "the obvious one" — the first result, which is
      // what the provider ranked highest.
      const chosen = results[activeIndex >= 0 ? activeIndex : 0];
      if (chosen) {
        event.preventDefault();
        select(chosen);
      }
    }
  };

  const optionId = (index: number) => `${listboxId}-option-${index}`;
  const showList = expanded && open && query.trim().length > 0;

  if (!expanded) {
    return (
      <div className="address-search" ref={rootRef}>
        <button
          type="button"
          className="address-search-toggle"
          title="Search for a place"
          aria-label="Search for a place"
          onClick={() => {
            setSheet(null);
            setExpanded(true);
            setOpen(true);
            // The point of the click was to type.
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="address-search address-search-open" ref={rootRef}>
      <svg
        className="address-search-icon"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        className="address-search-input"
        role="combobox"
        aria-label="Search for a place"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          activeIndex >= 0 ? optionId(activeIndex) : undefined
        }
        placeholder="Search a place…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {query.length > 0 && (
        <button
          type="button"
          className="address-search-clear"
          title="Clear the search"
          aria-label="Clear the search"
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
        >
          ×
        </button>
      )}
      <button
        type="button"
        className="address-search-close"
        aria-label="Close place search"
        title="Close place search"
        onClick={collapse}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 7 10 10M17 7 7 17" />
        </svg>
      </button>
      {showList && (
        <ul className="address-search-list" id={listboxId} role="listbox">
          {results.map((result, index) => (
            <li
              key={`${result.label}-${index}`}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={`address-search-option${
                index === activeIndex ? " is-active" : ""
              }`}
              // `mouseDown`, not `click`: the input's blur would otherwise
              // close the list before the click landed on it.
              onMouseDown={(e) => {
                e.preventDefault();
                select(result);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {result.label}
            </li>
          ))}
          {loading && (
            <li className="address-search-note" role="presentation">
              Searching…
            </li>
          )}
          {!loading && error !== null && (
            <li className="address-search-note" role="presentation">
              {error}
            </li>
          )}
          {!loading && error === null && results.length === 0 && (
            <li className="address-search-note" role="presentation">
              No places found
            </li>
          )}
          {/* A licence obligation, in the one place the data is shown. */}
          <li className="address-search-credit" role="presentation">
            {PHOTON_ATTRIBUTION}
          </li>
        </ul>
      )}
    </div>
  );
}
