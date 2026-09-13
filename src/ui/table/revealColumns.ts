/**
 * "Scroll these columns into view" — the channel between a run's result card
 * and the grid (spec §6.2).
 *
 * A module channel rather than a store, and rather than a prop: the card is in
 * the RIGHT panel and the grid is in the drawer, with `appendColumns` already
 * crossing the same gap through the query store. What the query store cannot
 * carry is a MOMENT — a column list that is "visible" is state, but "scroll to
 * it now" happens once and must not fire again on the next render.
 *
 * A REQUEST IS RETAINED UNTIL A LISTENER ACKNOWLEDGES IT, which is why the
 * listener returns a boolean. Three things happen between the click and the
 * headers, and each of them delivers a request to something that cannot scroll
 * yet: Open table opens the drawer, so the grid may not be mounted at all; a
 * grid that IS mounted may be showing another layer; and a mounted grid on the
 * right layer renders no `<th>` until its query answers (it returns the empty
 * placeholder while `rows` is empty). Consuming the request at any of those
 * loses it for good, and the scroll the user asked for never happens. So the
 * channel keeps the latest outstanding request PER LAYER and offers it to
 * every new listener and to every {@link drainColumnReveals} — which the grid
 * calls whenever its own headers change.
 */
export interface ColumnReveal {
  readonly layerId: string;
  readonly columns: ReadonlyArray<string>;
}

/** Returns true when the reveal was HONOURED — a matching header was found and
 *  scrolled to. False means "not mine, or not yet", and the request stays. */
type Listener = (reveal: ColumnReveal) => boolean;

const listeners = new Set<Listener>();
/** Outstanding requests, by layer id: the latest per layer, because a second
 *  run on the same layer supersedes the first — the user is looking at the
 *  newest card. Insertion-ordered, so the oldest LAYER is offered first. */
const pending = new Map<string, ReadonlyArray<string>>();

export function requestColumnReveal(
  layerId: string,
  columns: ReadonlyArray<string>,
): void {
  // Nothing to scroll to: an empty list is a no-op by definition, and it
  // clears any outstanding request for that layer rather than leaving a stale
  // one behind.
  if (columns.length === 0) {
    pending.delete(layerId);
    return;
  }
  const reveal: ColumnReveal = { layerId, columns: [...columns] };
  // Recorded BEFORE the offer, and deleted only on acknowledgement: a request
  // that a live grid honours at once must still REPLACE the one it supersedes,
  // or the grid's next drain — one column-list change later — would scroll
  // back to the previous run's columns.
  pending.set(layerId, reveal.columns);
  for (const listener of Array.from(listeners)) {
    if (listener(reveal)) {
      pending.delete(layerId);
      return;
    }
  }
}

export function subscribeColumnReveal(listener: Listener): () => void {
  listeners.add(listener);
  drainColumnReveals(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Re-offer every outstanding request to one listener, dropping the ones it
 * takes.
 *
 * The grid calls this when its layer or its rendered headers change: the
 * request may have arrived while it was showing another layer, or before its
 * query answered and it had any `<th>` to scroll to.
 */
export function drainColumnReveals(listener: Listener): void {
  for (const [layerId, columns] of Array.from(pending)) {
    if (listener({ layerId, columns })) pending.delete(layerId);
  }
}

/** Drop every outstanding request. For tests: the channel is module state, and
 *  a retained request would be delivered to the next case's first listener. */
export function clearColumnReveals(): void {
  pending.clear();
}
