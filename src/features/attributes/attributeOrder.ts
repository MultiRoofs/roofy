/** Per-layer preferences, keyed by the exact city-object type. */
export type AttributeOrders = Readonly<Record<string, ReadonlyArray<string>>>;

export function normalizeAttributeOrders(
  value: unknown,
): AttributeOrders | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const entries = Object.entries(value).flatMap(([type, keys]) =>
    Array.isArray(keys) && keys.every((key) => typeof key === "string")
      ? [[type, [...new Set(keys)]] as const]
      : [],
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

export function attributeKeys(
  attributes: Readonly<Record<string, unknown>>,
  saved: ReadonlyArray<string> = [],
): string[] {
  return [...new Set([...saved, ...Object.keys(attributes)])].filter((key) =>
    Object.hasOwn(attributes, key),
  );
}

export function reorderAttribute(
  saved: ReadonlyArray<string>,
  present: ReadonlyArray<string>,
  source: string,
  target: string,
): ReadonlyArray<string> {
  const keys = [...new Set([...saved, ...present])];
  const from = keys.indexOf(source);
  const to = keys.indexOf(target);
  if (from < 0 || to < 0 || from === to) return keys;
  keys.splice(from, 1);
  keys.splice(to, 0, source);
  return keys;
}
