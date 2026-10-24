# UI consistency — Soft Utility

The approved app direction is B, Soft Utility. `src/app/flatControls.css` owns shared control appearance; component CSS owns layout. Reuse existing controls and `ActionIcon` before introducing new ones.

- Use `--control-radius` (8px) for buttons and form fields. Do not invent local radii or pill-shaped numeric fields.
- Use `--control-height` (38px) for primary controls and `--control-height-compact` (30px) for dense fields. Compact controls keep the same radius, colors, focus treatment, and typography; do not shrink them arbitrarily.
- Use shared control background, border, selected, hover, and focus tokens in both themes. Range sliders use the shared slider rules; checkbox/radio indicators and slider thumbs retain their distinct shapes.
- Keep related controls 8px apart and separate distinct groups more generously. Labels and values must remain readable, including in the layer panel.
- Keep icons consistent with `ActionIcon`, with visible text for unfamiliar actions. Preserve keyboard focus and disabled states.
- Before finishing a UI change, compare the affected controls with their peers in the browser, including compact panels, both themes, and narrow layouts. Check computed radius and height as well as appearance: the same radius on a much shorter field can still look inconsistent.
- Improve shared styles when a problem applies to multiple controls. Any intentional exception must have a concrete interaction reason documented beside its CSS; do not fix drift with another isolated override.
