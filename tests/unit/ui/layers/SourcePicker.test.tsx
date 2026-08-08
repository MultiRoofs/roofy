/**
 * The one way into the viewer, tested at the component that owns it.
 *
 * `SourcePicker` renders in TWO places — the landing page hero and the Add
 * Layer dialog — so everything it offers has to work without knowing which.
 * What is checked here is the source-shape contract: a single file still goes
 * to `onFile`, and the two affordances a CityParquet PACKAGE needs (a folder
 * picker, and a drop carrying several files) go to `onFiles` as one group.
 * `onFiles` is optional, so the fallback to `onFile(files[0])` is checked too:
 * a caller that never learned about packages must not silently drop the drop.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  SourcePicker,
  SUPPORTED_FORMATS,
} from "../../../../src/ui/layers/SourcePicker";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A drop event carrying files, the way a browser delivers one. jsdom has no
 *  real `DataTransfer`, so the shape the handler reads is supplied directly. */
function fileDrop(files: readonly File[]) {
  return { dataTransfer: { files, types: ["Files"], dropEffect: "" } };
}

/** The browse input and the folder input are both hidden (a hidden input is
 *  not focusable, so each has a real button in front of it) — neither is
 *  reachable by role, hence the attribute queries. */
function folderInput(): HTMLInputElement {
  return document.querySelector("input[webkitdirectory]") as HTMLInputElement;
}

function browseInput(): HTMLInputElement {
  return document.querySelector(
    'input[type="file"]:not([webkitdirectory])',
  ) as HTMLInputElement;
}

describe("SourcePicker — folder picking", () => {
  it("offers a folder picker that reports all selected files", () => {
    const onFiles = vi.fn();
    render(
      <SourcePicker
        onFile={vi.fn()}
        onFiles={onFiles}
        onUrl={vi.fn()}
        loading={false}
      />,
    );

    const input = folderInput();
    expect(input).not.toBeNull();

    const f1 = new File(["a"], "building.parquet");
    const f2 = new File(["b"], "metadata.json");
    Object.defineProperty(input, "files", { value: [f1, f2] });
    fireEvent.change(input);

    expect(onFiles).toHaveBeenCalledWith([f1, f2]);
    // Cleared, so re-picking the SAME folder fires `change` again.
    expect(input.value).toBe("");
  });

  it("wires the Choose folder button to the folder input", () => {
    const clicked: HTMLElement[] = [];
    vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(
      function (this: HTMLInputElement) {
        clicked.push(this);
      },
    );
    render(
      <SourcePicker
        onFile={vi.fn()}
        onFiles={vi.fn()}
        onUrl={vi.fn()}
        loading={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }));

    expect(clicked).toEqual([folderInput()]);
  });

  it("keeps a ONE-table folder a group, so the layer is named after the folder", () => {
    const onFile = vi.fn();
    const onFiles = vi.fn();
    render(
      <SourcePicker
        onFile={onFile}
        onFiles={onFiles}
        onUrl={vi.fn()}
        loading={false}
      />,
    );

    // A package can be a single table with no `metadata.json`. Only the group
    // path reads `webkitRelativePath`, which is where the name "delft" is —
    // `onFile` would name the layer "building.parquet".
    const only = new File(["a"], "building.parquet");
    Object.defineProperty(only, "webkitRelativePath", {
      value: "delft/building.parquet",
    });
    const input = folderInput();
    Object.defineProperty(input, "files", { value: [only] });
    fireEvent.change(input);

    expect(onFiles).toHaveBeenCalledWith([only]);
    expect(onFile).not.toHaveBeenCalled();
  });

  it("ignores an empty folder selection", () => {
    const onFiles = vi.fn();
    const onFile = vi.fn();
    render(
      <SourcePicker
        onFile={onFile}
        onFiles={onFiles}
        onUrl={vi.fn()}
        loading={false}
      />,
    );

    const input = folderInput();
    Object.defineProperty(input, "files", { value: [] });
    fireEvent.change(input);

    expect(onFiles).not.toHaveBeenCalled();
    expect(onFile).not.toHaveBeenCalled();
  });
});

describe("SourcePicker — dropping", () => {
  it("routes a multi-file drop to onFiles and a single file to onFile", () => {
    const onFile = vi.fn();
    const onFiles = vi.fn();
    render(
      <SourcePicker
        onFile={onFile}
        onFiles={onFiles}
        onUrl={vi.fn()}
        loading={false}
      />,
    );
    const zone = screen.getByTestId("source-picker-drop-zone");

    const a = new File(["a"], "building.parquet");
    const b = new File(["b"], "metadata.json");
    fireEvent.drop(zone, fileDrop([a, b]));

    expect(onFiles).toHaveBeenCalledWith([a, b]);
    expect(onFile).not.toHaveBeenCalled();

    const single = new File(["{}"], "delft.city.json");
    fireEvent.drop(zone, fileDrop([single]));

    expect(onFile).toHaveBeenCalledWith(single);
    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  it("falls back to onFile for a multi-file drop when onFiles is absent", () => {
    const onFile = vi.fn();
    render(<SourcePicker onFile={onFile} onUrl={vi.fn()} loading={false} />);

    const a = new File(["a"], "building.parquet");
    const b = new File(["b"], "metadata.json");
    fireEvent.drop(
      screen.getByTestId("source-picker-drop-zone"),
      fileDrop([a, b]),
    );

    expect(onFile).toHaveBeenCalledWith(a);
  });

  it("does not try to load a dropped DIRECTORY, and says what to do instead", () => {
    const onFile = vi.fn();
    const onFiles = vi.fn();
    render(
      <SourcePicker
        onFile={onFile}
        onFiles={onFiles}
        onUrl={vi.fn()}
        loading={false}
      />,
    );

    // What a browser delivers for a dropped folder: one zero-byte `File` that
    // no parser can read, plus an ITEM that admits it is a directory.
    const dir = new File([], "delft");
    fireEvent.drop(screen.getByTestId("source-picker-drop-zone"), {
      dataTransfer: {
        files: [dir],
        types: ["Files"],
        dropEffect: "",
        items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }],
      },
    });

    expect(onFile).not.toHaveBeenCalled();
    expect(onFiles).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("Choose folder");
  });

  it("falls back to onFile for a folder pick when onFiles is absent", () => {
    const onFile = vi.fn();
    render(<SourcePicker onFile={onFile} onUrl={vi.fn()} loading={false} />);

    const input = folderInput();
    const f1 = new File(["a"], "building.parquet");
    Object.defineProperty(input, "files", { value: [f1] });
    fireEvent.change(input);

    expect(onFile).toHaveBeenCalledWith(f1);
  });
});

describe("SourcePicker — advertised formats", () => {
  it("accepts .parquet in the browse input", () => {
    render(<SourcePicker onFile={vi.fn()} onUrl={vi.fn()} loading={false} />);

    expect(browseInput().getAttribute("accept")).toContain(".parquet");
  });

  it("lists CityParquet in the format hint and the drop copy", () => {
    render(<SourcePicker onFile={vi.fn()} onUrl={vi.fn()} loading={false} />);

    expect(SUPPORTED_FORMATS).toBe(
      ".city.json · .city.jsonl · .fcb · .gml · .parquet",
    );
    expect(screen.getByText(SUPPORTED_FORMATS)).toBeTruthy();
    expect(screen.getByTestId("source-picker-drop-zone").textContent).toContain(
      "CityParquet folder",
    );
  });
});
