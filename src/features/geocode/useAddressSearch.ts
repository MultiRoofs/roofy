/**
 * Search-as-you-type against {@link searchAddresses}, with the two guards that
 * turn a geocoder call into an autocomplete.
 *
 * DEBOUNCE + MINIMUM LENGTH, because the provider is someone else's free
 * service: one request per PAUSE, never one per keystroke, and nothing at all
 * for a query too short to be a place.
 *
 * ABORT + GENERATION GUARD, because responses do not arrive in the order they
 * were sent. Each keystroke aborts the request in flight, and the effect that
 * sent a request also refuses to apply its result once it has been cleaned up —
 * both, not either: the `AbortController` is what stops the network work, but
 * a response already decoding cannot be un-decoded, and a provider (or a test
 * double) that ignores the signal would otherwise still let a slow answer for
 * "Delf" overwrite a fast one for "Delft".
 */
import { useEffect, useState } from "react";
import { searchAddresses, type GeocodeResult } from "./photon";

/** How long the typing has to pause before a request goes out. */
export const SEARCH_DEBOUNCE_MS = 300;
/** Shorter than this is not a place, it is the start of one. */
export const MIN_QUERY_LENGTH = 3;

export interface AddressSearchState {
  readonly results: readonly GeocodeResult[];
  readonly loading: boolean;
  /** A message to show in the dropdown, or `null`. Never a thrown error and
   *  never a toast: a search that fails while the user types must not queue up
   *  a wall of notifications. */
  readonly error: string | null;
}

const IDLE: AddressSearchState = { results: [], loading: false, error: null };

export function useAddressSearch(query: string): AddressSearchState {
  const [state, setState] = useState<AddressSearchState>(IDLE);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setState(IDLE);
      return;
    }

    // `loading` immediately, before the debounce: the dropdown says "searching"
    // from the first keystroke, rather than looking inert for 300 ms.
    setState({ results: [], loading: true, error: null });

    let live = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchAddresses(trimmed, controller.signal)
        .then((results) => {
          if (!live) return;
          setState({ results, loading: false, error: null });
        })
        .catch((error: unknown) => {
          // An abort is not a failure — it is this hook cancelling itself —
          // and the effect that issued it is already gone.
          if (!live) return;
          setState({
            results: [],
            loading: false,
            error:
              error instanceof Error && error.name === "AbortError"
                ? null
                : "Search unavailable",
          });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return state;
}
