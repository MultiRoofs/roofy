import type { ColumnInfo } from "../../insights/columnKind";

export function orderedColumns(
  columns: ReadonlyArray<ColumnInfo>,
  names: ReadonlyArray<string>,
): ReadonlyArray<ColumnInfo> {
  const byName = new Map(columns.map((column) => [column.name, column]));
  return [...new Set(names)].flatMap((name) => {
    const column = byName.get(name);
    return column ? [column] : [];
  });
}

export function moveColumn(
  names: ReadonlyArray<string>,
  source: string,
  target: string,
): ReadonlyArray<string> {
  const from = names.indexOf(source);
  const to = names.indexOf(target);
  if (from < 0 || to < 0 || from === to) return names;
  const next = [...names];
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}
