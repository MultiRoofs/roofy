/**
 * The catalog browser's session cache.
 *
 * WHY A STORE AND NOT A HOOK'S `useEffect`. Both of the fetches behind this are
 * expensive in a way a component's lifetime does not respect: the collection
 * crawl is ~53 HTTP requests (`stacClient`), and a collection's item index is a
 * whole parquet file read through DuckDB (`stacItems`). A hook-local fetch would
 * redo all of that every time the user closed and reopened the dialog. Keeping
 * the results in a module-level store makes the second open instant, which is
 * the entire point of the feature.
 *
 * WHY THE GUARDS ARE STATUS-BASED AND NOT A BOOLEAN. "Already fetched" is not
 * one condition but three with different answers: `loading` must be suppressed
 * (a second crawl would race the first), `ready` must be suppressed (that IS the
 * cache), and `error` must NOT be — a repeat call after a failure is the retry
 * the user just asked for. Collapsing them into `if (fetched) return` is how a
 * catalog browser ends up permanently stuck on "could not reach the catalog"
 * with a Retry button that does nothing.
 *
 * A READY-BUT-EMPTY result is a legitimate state, not a failure: a catalog with
 * no children, or a collection whose mirror holds no rows, is `ready` with an
 * empty list and no error. The UI distinguishes it by status, never by length —
 * only an `error` entry is worth a retry.
 *
 * NO CANCELLATION. Neither fetcher is aborted when the dialog closes: the crawl
 * is the thing we want to finish and keep, and abandoning a half-finished one
 * would leave the next open to start over. `fetchStacCollections` takes a signal
 * for other callers; this store deliberately passes none.
 */
import { create } from "zustand";
import { fetchStacCollections } from "./stacClient";
import { fetchCollectionItems } from "./stacItems";
import type { StacCollectionCard, StacItemRecord } from "./stacTypes";

export type StacFetchStatus = "idle" | "loading" | "ready" | "error";

/** One collection's item index, with its own independent lifecycle — a failure
 *  in one collection says nothing about any other. */
export interface StacItemsEntry {
  readonly status: StacFetchStatus;
  /** The fetcher's own sentence, ready to render. Null unless `status` is
   *  `"error"`. */
  readonly error: string | null;
  readonly items: readonly StacItemRecord[];
}

export interface StacStoreState {
  readonly collectionsStatus: StacFetchStatus;
  readonly collectionsError: string | null;
  /** Sorted by the fetcher, not here — see `fetchStacCollections`. */
  readonly collections: readonly StacCollectionCard[];
  /** Keyed by collection id. An absent key means "never asked". */
  readonly itemsByCollection: Readonly<Record<string, StacItemsEntry>>;
}

export interface StacStoreActions {
  /**
   * Crawl the catalog, unless it is already in flight or already cached.
   *
   * A call while `status` is `"error"` DOES re-crawl, so a caller that simply
   * mounts and calls this on every open recovers by itself once the network
   * comes back.
   */
  loadCollections: () => void;
  /** Force a re-crawl after a failure: clears the error, then loads. */
  retryCollections: () => void;
  /**
   * Read one collection's item index, unless that collection is already in
   * flight or already cached.
   *
   * This IS the per-collection retry path — the Retry button on a failed
   * collection calls it again with the same card.
   */
  loadItems: (card: StacCollectionCard) => void;
}

export type StacStore = StacStoreState & StacStoreActions;

/** The same type under the name the browser's plan and its consumers use. The
 *  split above is the repo's store convention (`QueryRegionStore*`); nothing
 *  reads state without also reaching for an action, so both names denote the
 *  whole surface. */
export type StacState = StacStore;

/** The fetchers throw `Error`s written for a human, so their message is what
 *  the UI shows. Anything else (a string thrown by a stub, a rejected
 *  non-Error) still has to produce a sentence rather than "[object Object]". */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message !== "") return error.message;
  const text = String(error);
  return text === "" ? "Something went wrong." : text;
}

const LOADING_ENTRY: StacItemsEntry = {
  status: "loading",
  error: null,
  items: [],
};

/** True when a status means "there is nothing to do" — in flight, or cached.
 *  `idle` and `error` both fall through to a fetch. */
function isSettledOrBusy(status: StacFetchStatus): boolean {
  return status === "loading" || status === "ready";
}

export const useStacStore = create<StacStore>((set, get) => ({
  collectionsStatus: "idle",
  collectionsError: null,
  collections: [],
  itemsByCollection: {},

  loadCollections: () => {
    if (isSettledOrBusy(get().collectionsStatus)) return;
    set({ collectionsStatus: "loading", collectionsError: null });

    fetchStacCollections().then(
      (cards) =>
        set({
          collectionsStatus: "ready",
          collectionsError: null,
          collections: cards,
        }),
      (error: unknown) =>
        set({
          collectionsStatus: "error",
          collectionsError: messageOf(error),
          // The previous cards, if any, are left alone: showing a stale list
          // above an error banner beats emptying the dialog.
        }),
    );
  },

  retryCollections: () => {
    // A crawl already running is the retry: resetting to "idle" underneath it
    // would open a SECOND crawl whose result races the first, and the loser
    // would still write its own status. The Retry button is only reachable from
    // "error", so this only guards a programmatic caller.
    if (get().collectionsStatus === "loading") return;
    // Reset first so the guard in `loadCollections` cannot mistake a lingering
    // "error" — or a cached "ready", when the caller explicitly wants fresh
    // cards — for a reason to skip.
    set({ collectionsStatus: "idle", collectionsError: null });
    get().loadCollections();
  },

  loadItems: (card) => {
    const id = card.id;
    const existing = get().itemsByCollection[id];
    if (existing !== undefined && isSettledOrBusy(existing.status)) return;

    // Every write spread-copies the record rather than mutating it, so a
    // component subscribed to `itemsByCollection` re-renders — and so one
    // collection's write never disturbs another collection's entry identity.
    set((state) => ({
      itemsByCollection: { ...state.itemsByCollection, [id]: LOADING_ENTRY },
    }));

    fetchCollectionItems(card).then(
      (items) =>
        set((state) => ({
          itemsByCollection: {
            ...state.itemsByCollection,
            [id]: { status: "ready", error: null, items },
          },
        })),
      (error: unknown) =>
        set((state) => ({
          itemsByCollection: {
            ...state.itemsByCollection,
            [id]: { status: "error", error: messageOf(error), items: [] },
          },
        })),
    );
  },
}));
