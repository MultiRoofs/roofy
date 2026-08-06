/**
 * The toolbar's address search.
 *
 * `fetch` is mocked (no live network in a unit test) and the camera is an
 * injected spy — the component knows no engine, it only calls the `flyTo` the
 * app hands it, exactly as "Zoom to fit" reaches `fitAll`.
 *
 * The combobox contract is the interesting half: a search box that can only be
 * driven with a mouse is a search box half the users cannot reach, so the
 * keyboard path and the ARIA wiring are pinned here rather than left to a
 * browser smoke.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { AddressSearch } from "../../../../src/ui/toolbar/AddressSearch";
import { SEARCH_DEBOUNCE_MS } from "../../../../src/features/geocode/useAddressSearch";
import { PHOTON_ATTRIBUTION } from "../../../../src/features/geocode/photon";

function photonBody(
  places: readonly {
    name: string;
    coords: readonly [number, number];
    extent?: readonly number[];
  }[],
) {
  return {
    features: places.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: p.coords },
      properties: p.extent
        ? { name: p.name, extent: p.extent }
        : { name: p.name },
    })),
  };
}

const DELFT_AND_DELFZIJL = photonBody([
  {
    name: "Delft",
    coords: [4.357, 52.011],
    extent: [4.31, 52.04, 4.41, 51.98],
  },
  { name: "Delfzijl", coords: [6.92, 53.33] },
]);

function stubFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body })),
  );
}

/** Open the box, type, and let the debounce and the response land. */
async function search(text: string) {
  fireEvent.click(screen.getByRole("button", { name: /search/i }));
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: text } });
  await act(async () => {
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();
  });
  return input;
}

beforeEach(() => {
  vi.useFakeTimers();
  stubFetch(DELFT_AND_DELFZIJL);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("AddressSearch", () => {
  it("starts collapsed and expands to an input", () => {
    render(<AddressSearch onFlyTo={vi.fn()} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("lists what the geocoder found, and credits it", async () => {
    render(<AddressSearch onFlyTo={vi.fn()} />);
    await search("Delft");
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Delft",
      "Delfzijl",
    ]);
    // The credit belongs in the dropdown, not on the map: no Photon data is
    // ever drawn on the globe.
    expect(screen.getByText(PHOTON_ATTRIBUTION)).toBeTruthy();
  });

  it("flies to the picked result, with a height from its extent", async () => {
    const onFlyTo = vi.fn();
    render(<AddressSearch onFlyTo={onFlyTo} />);
    await search("Delft");
    expect(screen.getByRole("listbox")).toBeTruthy();
    // `mouseDown` is what the option listens for — the input's blur would
    // close the list before a `click` could land (see the component).
    fireEvent.mouseDown(screen.getAllByRole("option")[0]!);
    expect(onFlyTo).toHaveBeenCalledTimes(1);
    const [target] = onFlyTo.mock.calls[0]!;
    expect(target.lng).toBeCloseTo(4.357, 6);
    expect(target.lat).toBeCloseTo(52.011, 6);
    // A city-sized extent: thousands of metres, not the no-extent default.
    expect(target.heightM).toBeGreaterThan(3000);
  });

  it("uses the default height for a result with no extent", async () => {
    const onFlyTo = vi.fn();
    render(<AddressSearch onFlyTo={onFlyTo} />);
    await search("Delft");
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.mouseDown(screen.getAllByRole("option")[1]!);
    expect(onFlyTo.mock.calls[0]![0].heightM).toBe(1500);
  });

  it("selects with the keyboard: arrows move, Enter flies", async () => {
    const onFlyTo = vi.fn();
    render(<AddressSearch onFlyTo={onFlyTo} />);
    const input = await search("Delft");
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      screen.getAllByRole("option")[0]!.id,
    );
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      screen.getAllByRole("option")[1]!.id,
    );
    expect(
      screen.getAllByRole("option")[1]!.getAttribute("aria-selected"),
    ).toBe("true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      screen.getAllByRole("option")[0]!.id,
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onFlyTo).toHaveBeenCalledTimes(1);
    expect(onFlyTo.mock.calls[0]![0].lng).toBeCloseTo(4.357, 6);
  });

  it("takes the first result when Enter is pressed without arrowing", async () => {
    const onFlyTo = vi.fn();
    render(<AddressSearch onFlyTo={onFlyTo} />);
    const input = await search("Delft");
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onFlyTo.mock.calls[0]![0].lat).toBeCloseTo(52.011, 6);
  });

  it("makes Enter inert once Escape has collapsed the list", async () => {
    // The combobox contract: Enter acts on what the user can SEE. After
    // Escape closes the popup, Enter must not fly to a result that is no
    // longer on screen.
    const onFlyTo = vi.fn();
    render(<AddressSearch onFlyTo={onFlyTo} />);
    const input = await search("Delft");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onFlyTo).not.toHaveBeenCalled();
    // And the collapsed input no longer points at an option that is gone.
    expect(input.getAttribute("aria-activedescendant")).toBeFalsy();
  });

  it("announces the dropdown through aria-expanded", async () => {
    render(<AddressSearch onFlyTo={vi.fn()} />);
    const input = await search("Delft");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes when the pointer goes elsewhere", async () => {
    render(<AddressSearch onFlyTo={vi.fn()} />);
    await search("Delft");
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("says so when the geocoder is unreachable, instead of raising a toast", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    render(<AddressSearch onFlyTo={vi.fn()} />);
    await search("Delft");
    expect(screen.getByText(/search unavailable/i)).toBeTruthy();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("reports an empty search rather than an empty dropdown", async () => {
    stubFetch({ features: [] });
    render(<AddressSearch onFlyTo={vi.fn()} />);
    await search("Zzzzzz");
    expect(screen.getByText(/no places/i)).toBeTruthy();
  });
});
