import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { FilterBar } from "../../../../src/ui/table/FilterBar";
import { operatorsFor } from "../../../../src/ui/table/tableText";
import type { ColumnInfo } from "../../../../src/analytics/columnKind";
import type { FilterGroup } from "../../../../src/features/query/types";

const COLUMNS: ReadonlyArray<ColumnInfo> = [
  { name: "id", type: "VARCHAR", kind: "scalar" },
  { name: "b3_h_dak_max", type: "DOUBLE", kind: "scalar" },
  { name: "parents", type: "VARCHAR[]", kind: "nested" },
  { name: "bouwjaar", type: "BIGINT", kind: "castText" },
];

const EMPTY: FilterGroup = { logic: "AND", conditions: [] };

function setup(over: Partial<Parameters<typeof FilterBar>[0]> = {}) {
  const onChange = vi.fn();
  const onApply = vi.fn();
  const onClear = vi.fn();
  render(
    <FilterBar
      columns={COLUMNS}
      filter={EMPTY}
      onChange={onChange}
      onApply={onApply}
      onClear={onClear}
      error={null}
      disabled={false}
      {...over}
    />,
  );
  return { onChange, onApply, onClear };
}

afterEach(cleanup);

describe("operatorsFor", () => {
  it("offers the LIKE family for VARCHAR and for castText, never for a number", () => {
    expect(operatorsFor(COLUMNS[0])).toContain("contains");
    // BIGINT: `compileFilter` casts the left side, so this is a real question.
    expect(operatorsFor(COLUMNS[3])).toContain("contains");
    expect(operatorsFor(COLUMNS[1])).not.toContain("contains");
  });

  it("offers only the null tests for a nested column", () => {
    expect(operatorsFor(COLUMNS[2])).toEqual(["isNull", "isNotNull"]);
  });

  it("offers nothing for no column", () => {
    expect(operatorsFor(undefined)).toEqual([]);
  });
});

describe("FilterBar", () => {
  it("adds a first condition defaulted to the first column", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as FilterGroup;
    expect(next.conditions).toHaveLength(1);
    expect(next.conditions[0]!.column).toBe("id");
    expect(next.conditions[0]!.op).toBe("=");
  });

  it("renders one row per condition, with its column selected", () => {
    setup({
      filter: {
        logic: "AND",
        conditions: [{ id: "c1", column: "b3_h_dak_max", op: ">", value: 10 }],
      },
    });
    const columnSelect = screen.getByLabelText("Filter column");
    expect((columnSelect as HTMLSelectElement).value).toBe("b3_h_dak_max");
    expect(
      (screen.getByLabelText("Filter operator") as HTMLSelectElement).value,
    ).toBe(">");
    expect(
      (screen.getByLabelText("Filter value") as HTMLInputElement).value,
    ).toBe("10");
  });

  it("hides the value input for a nullary operator", () => {
    setup({
      filter: {
        logic: "AND",
        conditions: [{ id: "c1", column: "parents", op: "isNull", value: "" }],
      },
    });
    expect(screen.queryByLabelText("Filter value")).toBeNull();
  });

  it("resets the operator when a column change makes it illegal", () => {
    const { onChange } = setup({
      filter: {
        logic: "AND",
        conditions: [{ id: "c1", column: "id", op: "contains", value: "NL" }],
      },
    });
    fireEvent.change(screen.getByLabelText("Filter column"), {
      target: { value: "parents" },
    });
    const next = onChange.mock.calls[0]![0] as FilterGroup;
    expect(next.conditions[0]!.column).toBe("parents");
    expect(next.conditions[0]!.op).toBe("isNull");
  });

  it("removes a condition", () => {
    const { onChange } = setup({
      filter: {
        logic: "AND",
        conditions: [
          { id: "c1", column: "id", op: "=", value: "a" },
          { id: "c2", column: "id", op: "=", value: "b" },
        ],
      },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Remove condition" })[0]!,
    );
    const next = onChange.mock.calls[0]![0] as FilterGroup;
    expect(next.conditions.map((c) => c.id)).toEqual(["c2"]);
  });

  it("toggles the group logic from the BAR, with a single condition present", () => {
    const { onChange } = setup({
      filter: {
        logic: "AND",
        conditions: [{ id: "c1", column: "id", op: "=", value: "a" }],
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Match ALL conditions" }),
    );
    expect((onChange.mock.calls[0]![0] as FilterGroup).logic).toBe("OR");
  });

  it("offers no logic toggle when there is nothing to combine", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: "Match ALL conditions" }),
    ).toBeNull();
  });

  it("leads the second row with the group's logic as TEXT, not a second toggle", () => {
    setup({
      filter: {
        logic: "OR",
        conditions: [
          { id: "c1", column: "id", op: "=", value: "a" },
          { id: "c2", column: "id", op: "=", value: "b" },
        ],
      },
    });
    expect(screen.getByText("Where")).toBeTruthy();
    expect(screen.getByText("OR")).toBeTruthy();
    // ONE toggle for the group, however many rows.
    expect(
      screen.getAllByRole("button", { name: "Match ANY conditions" }),
    ).toHaveLength(1);
  });

  it("applies and clears", () => {
    const { onApply, onClear } = setup({
      filter: {
        logic: "AND",
        conditions: [{ id: "c1", column: "id", op: "=", value: "a" }],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("cannot apply an empty filter", () => {
    setup();
    expect(
      (screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows an error as an alert", () => {
    setup({ error: 'This layer has no column called "gone".' });
    expect(screen.getByRole("alert").textContent).toBe(
      'This layer has no column called "gone".',
    );
  });

  it("disables every control while disabled", () => {
    setup({ disabled: true });
    expect(
      (
        screen.getByRole("button", {
          name: "Add condition",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

/**
 * A CONTROLLED harness, because the bug this covers only exists across
 * renders: the draft goes out through `onChange` and comes back as the input's
 * value, so a parse-on-keystroke eats its own separator on the way back in.
 */
function Typed({ initial }: { readonly initial: FilterGroup }) {
  const [filter, setFilter] = useState(initial);
  // The REF is what makes this a faithful stand-in for the store: zustand's
  // `setFilter` is a synchronous write and `applyFilter` reads it back with
  // `getState()`, so Apply sees the draft this same click just reshaped —
  // which a `useState` closure, frozen at the last render, would not.
  const draft = useRef(filter);
  const [applied, setApplied] = useState<FilterGroup | null>(null);
  const change = (next: FilterGroup) => {
    draft.current = next;
    setFilter(next);
  };
  return (
    <>
      <FilterBar
        columns={COLUMNS}
        filter={filter}
        onChange={change}
        onApply={() => setApplied(draft.current)}
        onClear={() => change(EMPTY)}
        error={null}
        disabled={false}
      />
      <output data-testid="applied">{JSON.stringify(applied)}</output>
    </>
  );
}

describe('FilterBar "is one of" values', () => {
  it("keeps the comma while typing, and splits only at Apply", () => {
    render(
      <Typed
        initial={{
          logic: "AND",
          conditions: [{ id: "c1", column: "id", op: "in", value: "" }],
        }}
      />,
    );
    const input = screen.getByLabelText("Filter value") as HTMLInputElement;

    // Typed one character at a time: a per-keystroke split turns "a," back
    // into "a", so the comma can never be followed by anything.
    for (const text of ["a", "a,", "a,b"]) {
      fireEvent.change(input, { target: { value: text } });
      expect(
        (screen.getByLabelText("Filter value") as HTMLInputElement).value,
      ).toBe(text);
    }

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    const applied = JSON.parse(
      screen.getByTestId("applied").textContent!,
    ) as FilterGroup;
    expect(applied.conditions[0]!.value).toEqual(["a", "b"]);
  });

  it("reshapes an applied list back to text when the operator leaves 'in'", () => {
    // `=` against a list is refused for SHAPE by compileFilter, so a draft
    // that came back from an apply must not keep the array.
    const { onChange } = setup({
      filter: {
        logic: "AND",
        conditions: [{ id: "c1", column: "id", op: "in", value: ["a", "b"] }],
      },
    });
    fireEvent.change(screen.getByLabelText("Filter operator"), {
      target: { value: "=" },
    });
    const next = onChange.mock.calls[0]![0] as FilterGroup;
    expect(next.conditions[0]!.op).toBe("=");
    expect(next.conditions[0]!.value).toBe("a, b");
  });
});
