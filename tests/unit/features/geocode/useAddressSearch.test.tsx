/**
 * The search-as-you-type hook.
 *
 * The two things that can go wrong here are invisible in a screenshot and
 * expensive in production, so they are pinned hard:
 *
 *  1. one request per keystroke instead of one per pause (the provider is a
 *     free public service, and its policy is the reason we are on Photon at
 *     all);
 *  2. a SLOW response for an OLD query landing after a fast one for the new
 *     query and overwriting it — the classic autocomplete bug, reproduced here
 *     by resolving request 1 after request 2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  MIN_QUERY_LENGTH,
  SEARCH_DEBOUNCE_MS,
  useAddressSearch,
} from "../../../../src/features/geocode/useAddressSearch";

/** Resolvers for the pending `fetch` calls, newest last. */
let pending: ((body: unknown) => void)[] = [];
let signals: (AbortSignal | undefined)[] = [];

function photonBody(labels: readonly string[]) {
  return {
    features: labels.map((name, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [i, i] },
      properties: { name },
    })),
  };
}

function Probe({ query }: { readonly query: string }) {
  const { results, loading, error } = useAddressSearch(query);
  return (
    <div>
      <span data-testid="state">
        {loading ? "loading" : error !== null ? `error:${error}` : "idle"}
      </span>
      <span data-testid="results">{results.map((r) => r.label).join("|")}</span>
    </div>
  );
}

beforeEach(() => {
  pending = [];
  signals = [];
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          signals.push(init?.signal);
          pending.push((body: unknown) =>
            resolve({ ok: true, status: 200, json: async () => body }),
          );
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Let the debounce elapse and every microtask settle. */
async function settle(ms = SEARCH_DEBOUNCE_MS) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe("useAddressSearch", () => {
  it("sends nothing for a query below the minimum length", async () => {
    render(<Probe query={"a".repeat(MIN_QUERY_LENGTH - 1)} />);
    await settle(SEARCH_DEBOUNCE_MS * 4);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("state").textContent).toBe("idle");
  });

  it("waits for the typing to pause before asking", async () => {
    const { rerender } = render(<Probe query="Del" />);
    // Still typing: each rerender restarts the debounce.
    await settle(SEARCH_DEBOUNCE_MS - 50);
    rerender(<Probe query="Delf" />);
    await settle(SEARCH_DEBOUNCE_MS - 50);
    rerender(<Probe query="Delft" />);
    expect(fetch).not.toHaveBeenCalled();
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("q=Delft");
  });

  it("shows results once they arrive", async () => {
    render(<Probe query="Delft" />);
    await settle();
    expect(screen.getByTestId("state").textContent).toBe("loading");
    await act(async () => {
      pending[0]!(photonBody(["Delft, NL"]));
      await Promise.resolve();
    });
    expect(screen.getByTestId("results").textContent).toBe("Delft, NL");
    expect(screen.getByTestId("state").textContent).toBe("idle");
  });

  it("never lets a stale response overwrite a fresher one", async () => {
    const { rerender } = render(<Probe query="Delft" />);
    await settle();
    rerender(<Probe query="Rotterdam" />);
    await settle();
    expect(pending).toHaveLength(2);

    // The SECOND query answers first — the normal case — and then the first
    // one finally lands. It must not resurrect "Delft".
    await act(async () => {
      pending[1]!(photonBody(["Rotterdam, NL"]));
      await Promise.resolve();
    });
    expect(screen.getByTestId("results").textContent).toBe("Rotterdam, NL");

    await act(async () => {
      pending[0]!(photonBody(["Delft, NL"]));
      await Promise.resolve();
    });
    expect(screen.getByTestId("results").textContent).toBe("Rotterdam, NL");
  });

  it("aborts the in-flight request on the next keystroke", async () => {
    const { rerender } = render(<Probe query="Delft" />);
    await settle();
    expect(signals[0]!.aborted).toBe(false);
    rerender(<Probe query="Rotterdam" />);
    await settle();
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });

  it("clears the results when the query drops below the minimum", async () => {
    const { rerender } = render(<Probe query="Delft" />);
    await settle();
    await act(async () => {
      pending[0]!(photonBody(["Delft, NL"]));
      await Promise.resolve();
    });
    expect(screen.getByTestId("results").textContent).toBe("Delft, NL");
    rerender(<Probe query="" />);
    await settle();
    expect(screen.getByTestId("results").textContent).toBe("");
    expect(screen.getByTestId("state").textContent).toBe("idle");
  });

  it("reports a failed search instead of leaving the spinner up", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })),
    );
    render(<Probe query="Delft" />);
    await settle();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("state").textContent).toMatch(/^error:/);
  });
});
