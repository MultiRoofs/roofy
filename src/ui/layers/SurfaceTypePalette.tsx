/**
 * "Color by surface type", explained: the three colours a city mesh is baked
 * with when no rule paints over them.
 *
 * READ-ONLY in v1, deliberately. These are not per-layer settings — they are
 * `CITY_COLORS`, the app's ONE answer, handed to both plugin constructors at
 * viewport construction (`scene/cityColors.ts`), and the collision rule that
 * chose their values (no base surface may equal a rule preset, the highlight
 * or the hover) is a property of the whole app, not of a layer. Making them
 * editable here would let one layer's roof be repainted into another layer's
 * selection colour. What this component owes the user is therefore a LEGEND:
 * "that orange is a roof", so the mode's name means something.
 *
 * Roof, Wall and Ground only, out of the nine `surfaceColors` keys: they are
 * the three a LoD-2 city model actually carries in quantity, and the reader is
 * choosing a colouring mode, not auditing a palette. The rest (closure, outer
 * ceiling, window, door, unknown) appear in the inspector's surface dots,
 * where a specific surface is under discussion.
 */
import { SURFACE_COLOR_HEX } from "../../scene/cityColors";

const ROWS: ReadonlyArray<{ readonly label: string; readonly color: string }> =
  [
    { label: "Roof", color: SURFACE_COLOR_HEX.RoofSurface },
    { label: "Wall", color: SURFACE_COLOR_HEX.WallSurface },
    { label: "Ground", color: SURFACE_COLOR_HEX.GroundSurface },
  ];

export function SurfaceTypePalette() {
  return (
    <div className="surface-palette-wrap">
      <ul className="surface-palette" aria-label="Surface type palette">
        {ROWS.map(({ label, color }) => (
          <li className="surface-palette-row" key={label}>
            <span
              className="surface-palette-swatch"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            <span>{label}</span>
            <code className="surface-palette-hex">{color.toUpperCase()}</code>
          </li>
        ))}
      </ul>
      <p className="surface-palette-note">Palette is read-only.</p>
    </div>
  );
}
