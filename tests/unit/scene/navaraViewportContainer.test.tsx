/**
 * One invariant, in its own file because proving it needs React's `useRef`
 * stubbed: **`CitySceneHandle.ready` must always settle** (Shared Interface
 * Contract → resolve-or-reject, never a hang).
 *
 * `NavaraViewport`'s lifecycle effect starts with `if (!containerRef.current)`.
 * That branch is unreachable in practice — the container div is rendered
 * unconditionally, so React has attached the ref before any effect runs — but
 * an early `return` there would leave `ready` pending forever with no error
 * panel, which is exactly the hang class fixed for the plugin-constructor
 * escape in B11a. Since no production path can produce a null container, the
 * only honest way to pin the guard is to make React hand the component a ref
 * that never accepts an element.
 *
 * The stub is deliberately narrow: only the FIRST `useRef` call of the first
 * render (the component's `containerRef`) is replaced, and only while the
 * one-shot flag below is armed. Everything else — including React's own
 * internals, which use the hook dispatcher rather than this export — is
 * untouched.
 */
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

/** Armed by the test; consumed by the next `useRef` call. */
let nextRefIsDetached = false;

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: (initial: unknown) => {
      const ref = actual.useRef(initial);
      if (!nextRefIsDetached) return ref;
      nextRefIsDetached = false;
      // A ref React can assign to but which never reports an element.
      const detached = {};
      Object.defineProperty(detached, "current", {
        get: () => null,
        set: () => undefined,
      });
      return detached;
    },
  };
});

const { NavaraViewport } = await import("../../../src/scene/NavaraViewport");
import type { CitySceneHandle } from "../../../src/scene/NavaraViewport";

const init = vi.fn(async () => {});
vi.mock("@navaramap/three", () => ({
  default: vi.fn(function () {
    return { addPlugin: vi.fn(), init, dispose: vi.fn(), on: vi.fn() };
  }),
}));
vi.mock("@navaramap/three-default-plugin", () => ({
  DefaultPlugin: vi.fn(function () {
    return { addDefaultPhotorealScene: vi.fn() };
  }),
}));
vi.mock("@cityjson/navara-cityjson/plugin", () => ({
  CityJSONPlugin: vi.fn(function () {
    return { getHandle: vi.fn(), addCityModel: vi.fn() };
  }),
}));

describe("NavaraViewport without a canvas container", () => {
  it("REJECTS `ready` and shows the error panel instead of hanging", async () => {
    nextRefIsDetached = true;
    const ref = createRef<CitySceneHandle>();
    const { findByRole } = render(
      <NavaraViewport ref={ref} onTriangleCount={() => {}} />,
    );

    await waitFor(() => expect(ref.current).not.toBeNull());
    await expect(ref.current!.ready).rejects.toThrow(
      /canvas container never mounted/,
    );
    expect((await findByRole("alert")).textContent).toMatch(
      /canvas container never mounted/,
    );
    // Nothing was constructed, so nothing needs disposing.
    expect(init).not.toHaveBeenCalled();
  });
});
