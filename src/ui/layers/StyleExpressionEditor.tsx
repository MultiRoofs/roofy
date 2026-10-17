/**
 * "Color by expression": the layer's colour expression as JSON, edited in
 * place.
 *
 * An edit reaches the layer only once it parses AND compiles, and only after
 * a pause in typing: every applied edit repaints the whole layer (a static
 * mesh recolours every vertex, a streamed one re-bakes every resident cell in
 * the worker), so half-typed text must never get that far. Until then the
 * layer keeps drawing the last expression that worked, and the reason this
 * one does not is shown under the editor.
 */
import { useEffect, useRef, useState } from "react";
import { compileStyleExpression } from "@cityjson/navara-core";
import { useLayerStore } from "../../features/layers/layerStore";
import type { LayerStyleExpression } from "../../features/rules/colorBy";

const APPLY_DELAY_MS = 400;

const SPEC_URL = "https://maplibre.org/maplibre-style-spec/expressions/";

/** An array this short, written inline, stays on one line. */
const INLINE_WIDTH = 48;

/** JSON with each array on one line when it fits, else one element per line:
 *  `JSON.stringify`'s own indentation puts every `"get"` on a line of its
 *  own, which turns a three-branch `case` into a page. */
function layout(value: unknown, indent: string): string {
  const inline = (v: unknown): string =>
    Array.isArray(v) ? `[${v.map(inline).join(", ")}]` : JSON.stringify(v);
  const flat = inline(value);
  if (!Array.isArray(value) || indent.length + flat.length <= INLINE_WIDTH) {
    return flat;
  }
  const inner = `${indent}  `;
  return `[\n${value
    .map((v) => inner + layout(v, inner))
    .join(",\n")}\n${indent}]`;
}

function format(expression: LayerStyleExpression | null): string {
  return expression === null ? "" : layout(expression, "");
}

/** Why `text` cannot be applied, or the expression it holds. */
function check(
  text: string,
):
  | { readonly ok: true; readonly expression: LayerStyleExpression }
  | { readonly ok: false; readonly errors: readonly string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      errors: [`Not valid JSON: ${(error as Error).message}`],
    };
  }
  if (!Array.isArray(parsed) && typeof parsed !== "string") {
    return {
      ok: false,
      errors: ["An expression is a JSON array, or a colour string."],
    };
  }
  const compiled = compileStyleExpression(parsed);
  return compiled.ok
    ? { ok: true, expression: parsed as LayerStyleExpression }
    : { ok: false, errors: compiled.errors };
}

export function StyleExpressionEditor({
  layerId,
  expression,
}: {
  readonly layerId: string;
  readonly expression: LayerStyleExpression | null;
}) {
  const updateLayer = useLayerStore((s) => s.updateLayer);
  const [text, setText] = useState(() => format(expression));
  const [errors, setErrors] = useState<readonly string[]>([]);
  // The expression this editor last wrote, so a store change it did not make
  // (Copy from…, a restore) replaces the text, and its own write does not.
  const applied = useRef(expression);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (expression === applied.current) return;
    applied.current = expression;
    clearTimeout(timer.current);
    setText(format(expression));
    setErrors([]);
  }, [expression]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onChange = (next: string) => {
    setText(next);
    clearTimeout(timer.current);
    const result = check(next);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    timer.current = setTimeout(() => {
      applied.current = result.expression;
      updateLayer(layerId, { styleExpression: result.expression });
    }, APPLY_DELAY_MS);
  };

  return (
    <div className="style-field">
      <label className="style-field">
        <span className="style-field-label">Colour expression</span>
        <textarea
          className="style-expression"
          aria-invalid={errors.length > 0}
          spellCheck={false}
          rows={10}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {errors.length > 0 && (
        <p role="alert" className="style-expression-error">
          {errors.join(" ")}
        </p>
      )}
      <p className="active-layer-note">
        A{" "}
        <a href={SPEC_URL} target="_blank" rel="noreferrer">
          MapLibre colour expression
        </a>
        , per surface. It reads the object&rsquo;s and surface&rsquo;s
        attributes, <code>areaSqM</code>, <code>inclinationDeg</code>,{" "}
        <code>azimuthDeg</code>, <code>elevationM</code>, and{" "}
        <code>$surface</code>, <code>$type</code>, <code>$id</code> and{" "}
        <code>$base</code> (the surface&rsquo;s own colour, which a result of
        null also keeps).
      </p>
    </div>
  );
}
