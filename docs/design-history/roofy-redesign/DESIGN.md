---
name: Roofy
description: Your city, roof by roof. A dark, calm light table for 3D city models, with four rooftop colours and a photoreal globe as the subject.
colors:
  # Brand hues: the four rooftop functions, in legend order. The "-deep" value
  # is the same hue on the light theme, where the brand darkens to hold
  # contrast on paper.
  meadow-lime: "#a7e32b"
  meadow-lime-deep: "#7cb518"
  noon-amber: "#ffc530"
  noon-amber-deep: "#f0a800"
  terracotta: "#f2683c"
  terracotta-deep: "#d9481c"
  canal-blue: "#3b82f6"
  canal-blue-deep: "#1e5fd8"
  unassigned-grey: "#8b93a3"
  # Lime ramp (the only tonal ramp the kit defines)
  lime-pale: "#edfbc8"
  lime-soft: "#cdf176"
  lime-shade: "#4a7a0f"
  lime-wash: "color-mix(in srgb, #a7e32b 13%, transparent)"
  blue-wash: "color-mix(in srgb, #3b82f6 14%, transparent)"
  terracotta-wash: "color-mix(in srgb, #f2683c 12%, transparent)"
  # Dark theme (default) surfaces and ink
  night-root: "#0b0e13"
  night-panel: "#12161e"
  night-raised: "#1d222c"
  night-toolbar: "#10141c"
  night-viewport: "#080a0e"
  night-input: "#161b24"
  night-glass: "rgba(11, 14, 19, 0.9)"
  paper-ink: "#f2f4ef"
  night-ink-muted: "#8a93a0"
  night-ink-label: "#a3abb7"
  night-ink-dim: "#5a6270"
  night-hairline: "rgba(255, 255, 255, 0.09)"
  night-hairline-strong: "rgba(255, 255, 255, 0.16)"
  # Light theme surfaces and ink
  paper-root: "#f6f7f2"
  paper-panel: "#ffffff"
  paper-raised: "#edefe7"
  paper-toolbar: "#fbfcf8"
  paper-viewport: "#e9ebe4"
  paper-input: "#f3f4ee"
  night-ink: "#14181e"
  paper-ink-muted: "#5c636e"
  paper-ink-label: "#4f5661"
  paper-ink-dim: "#8b93a3"
  paper-hairline: "rgba(20, 24, 30, 0.1)"
  paper-hairline-strong: "rgba(20, 24, 30, 0.18)"
typography:
  display:
    fontFamily: "Outfit Variable, Outfit, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Outfit Variable, Outfit, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Outfit Variable, Outfit, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  small:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.16em"
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "9px"
  lg: "14px"
  xl: "20px"
  icon: "18px"
  pill: "999px"
components:
  button-primary:
    backgroundColor: "{colors.meadow-lime}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.md}"
    padding: "8px 20px"
  button-primary-hover:
    backgroundColor: "{colors.lime-soft}"
    textColor: "{colors.night-ink}"
  button-primary-compact:
    backgroundColor: "{colors.meadow-lime}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.night-ink-muted}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.night-ink-muted}"
    rounded: "{rounded.sm}"
    size: "32px"
  button-icon-hover:
    backgroundColor: "{colors.night-raised}"
    textColor: "{colors.paper-ink}"
  button-icon-active:
    backgroundColor: "{colors.lime-wash}"
    textColor: "{colors.meadow-lime}"
  input:
    backgroundColor: "{colors.night-input}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.sm}"
    padding: "5px 6px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.night-ink-muted}"
    padding: "8px 12px"
  tab-active:
    backgroundColor: "transparent"
    textColor: "{colors.paper-ink}"
  card:
    backgroundColor: "{colors.night-raised}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.md}"
    padding: "11px"
  list-row:
    backgroundColor: "transparent"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
  list-row-active:
    backgroundColor: "{colors.lime-wash}"
    textColor: "{colors.paper-ink}"
  chip-outline:
    backgroundColor: "transparent"
    textColor: "{colors.meadow-lime}"
    rounded: "{rounded.pill}"
    padding: "1px 5px"
  glass-overlay:
    backgroundColor: "{colors.night-glass}"
    textColor: "{colors.paper-ink}"
    rounded: "{rounded.md}"
    padding: "8px 10px"
---

# Design System: Roofy

## Overview

**Creative North Star: "The Planner's Light Table"**

Roofy is a drafting surface for a city. The near-black shell (#0b0e13 root,
#12161e panels) is the table; the lit, georeferenced 3D model on the globe is
the drawing laid on it; the sidebar, inspector and toolbar are instruments set
around the drawing, never on top of it. Everything the interface does defers to
that reading: panels are flat and hairline-bordered, labels are typeset like plan
annotations in spaced monospace capitals, and colour is reserved for the roofs
and for the one thing you are touching.

The tone is friendly, clear and bright. Bright comes from the brand rather than
from the surfaces: Meadow Lime, Noon Amber, Terracotta and Canal Blue are the
four rooftop functions (nature, energy, social, water) and they carry warmth
into a dark, steady frame. Clear comes from plain copy and from a strict
hierarchy in which a non-specialist planner can always tell what is data, what
is a control and what is a state. A full light theme exists for paper and
projectors; on it the brand hues darken so borders, icons and text keep their
contrast, while the filled lime button stays exactly the same.

**Key Characteristics:**

- Dark by default, light theme as a first-class sibling; the OS preference picks the initial theme.
- One accent, Meadow Lime, used only for the active, the selected and the primary.
- Four rooftop hues that mean something; they are legend colours, not decoration.
- Outfit for names and headings, IBM Plex Sans for reading, IBM Plex Mono for labels and numbers.
- Flat shell with hairlines; glass only where something floats over the 3D view.
- Dense, instrument-like controls in the shell; generous scale only on the landing page.

## Colors

A single lime accent over near-black, with three more rooftop hues held back for the legend and for meaning.

### Primary

- **Meadow Lime** (#a7e32b): the interactive accent. Icon tint on active tools, the underline on the active tab, the border on the active layer row, the selection colour of picked buildings in the 3D view. On the light theme the tint role darkens to **Meadow Lime Deep** (#7cb518) for icons and borders, and lime used _as text on a panel_ steps to **Lime Shade** (#4a7a0f), because #7cb518 on white is only 2.5:1.
- **Lime Soft** (#cdf176): hover on filled buttons and the hover colour of buildings in the 3D view.
- **Lime Wash** (13% lime over transparent): the background of active states (active toolbar button, active layer row, active scope button). The wash never appears at rest.

### Secondary

- **Noon Amber** (#ffc530, light theme #f0a800): the energy legend colour and the warning colour. Never body text on the light theme (2.0:1 on white); use it as a swatch, a fill or an icon there.
- **Terracotta** (#f2683c, light theme #d9481c): the social legend colour and the danger colour. As text it holds 5.9:1 on the dark panel; on white #d9481c reaches 4.3:1, so on paper it is a swatch or an icon with an ink label, not running text.

### Tertiary

- **Canal Blue** (#3b82f6, light theme #1e5fd8): the water legend colour, data highlights and loading or streaming states. **Blue Wash** (14%) backs streaming diagnostics. Blue is the second hue in the page's ambient wash.

### Neutral

- **Night Root** (#0b0e13) is the page ground, **Night Panel** (#12161e) the sidebars and inspector, **Night Toolbar** (#10141c) the top bar and status bar, **Night Raised** (#1d222c) hover rows and cards, **Night Input** (#161b24) fields, **Night Viewport** (#080a0e) behind the canvas while it loads.
- **Night Glass** (rgba(11,14,19,0.9) with a 12px backdrop blur) is the only translucent surface: legend card, pick tooltip, toast, camera controls.
- **Paper Ink** (#f2f4ef) is text on dark; **Night Ink Muted** (#8a93a0, 5.8:1 on the panel) is secondary text; **Night Ink Label** (#a3abb7) sits between them for table headers. **Night Ink Dim** (#5a6270) reaches only 3:1 on the panel: placeholders, disabled controls and captions, never the sole ink of a readable label.
- **Unassigned Grey** (#8b93a3) is the fifth legend colour, for roofs no rule reached.
- Light theme mirrors every role: **Paper Root** (#f6f7f2), **Paper Panel** (#ffffff), **Paper Raised** (#edefe7), **Paper Toolbar** (#fbfcf8), **Paper Input** (#f3f4ee), **Night Ink** (#14181e) as text, **Paper Ink Muted** (#5c636e), **Paper Ink Label** (#4f5661), **Paper Ink Dim** (#8b93a3, again 3:1).
- Hairlines are white at 9% / 16% on dark and ink at 10% / 18% on light. The strong hairline marks the edge of anything floating and the active table header.

### Named Rules

**The One Accent Rule.** Meadow Lime is the only colour that means "interactive". Amber, terracotta and blue mean energy, social and water first; they may double as warn, danger and loading, but they never mark hover, focus or selection.

**The Selection Reserve Rule.** Lime 500 is the 3D selection colour and Lime 300 the 3D hover colour. No rule preset, legend entry, default geo-layer colour or base surface colour may equal either. Presets pick from the other three hues and the deeper lime.

**The Same Button Rule.** The filled primary button is #a7e32b with #14181e ink in both themes. Only the _tint_ uses of lime (icons, borders, text) darken on paper.

## Typography

**Display Font:** Outfit (variable, "Outfit Variable"; fallback system-ui)
**Body Font:** IBM Plex Sans (fallback system-ui)
**Label/Mono Font:** IBM Plex Mono (fallback ui-monospace, Menlo)

**Character:** A geometric display face with tight negative tracking for the name and headings, a neutral humanist sans for reading, and a monospace that turns every label into a plan annotation. Outfit also sets every button and tab, so controls read as "Roofy's voice" and data reads as "the city's".

### Hierarchy

The kit's scale is normative. The viewer shell runs it compressed (see Layout).

- **Display** (600, 48px, line-height 1, -0.03em): the landing headline only. In the app it scales as `clamp(2.8rem, 8vw, 5rem)` with line-height 0.95, capped at 16ch.
- **Headline** (600, 32px, 1.15, -0.02em): section titles on the landing page and modal titles.
- **Title** (500, 22px, 1.25, -0.01em): panel and dialog headings. In the shell the inspector heading runs at 0.88rem, 600.
- **Body** (400, 15px, 1.6): reading copy; the landing lede is 1.05rem at 1.6 on muted ink, max 42rem.
- **Small** (400, 13px, 1.5): descriptions inside panels and cards.
- **Label** (500, 11px, 1.2, 0.16em, UPPERCASE, mono, muted ink): every section title inside a panel (legend title, attribute panel title, rule target, snapshot list). Table headers use the same treatment at 0.06em tracking in the UI face.
- **Data** (400, 13px, mono): numbers, coordinates, the status bar, attribute values. In the shell the status bar runs at 0.7rem.

### Named Rules

**The Annotation Rule.** A heading inside a panel is a mono uppercase label, not a bigger sans. Size never carries hierarchy inside the shell; case, tracking and ink do.

**The Wordmark Rule.** "Roofy" is set in Outfit 600 at -0.03em and is never re-cased, re-spaced or wrapped in an uppercase parent. The lockup's mark is 1.15em of its type, pinned to 20px beside 15px type in the toolbar.

## Layout

The viewer is a fixed CSS grid: a 2.75rem toolbar across the top, a 1.75rem
mono status bar across the bottom, a 240px left sidebar (layers, sources), a
320px right inspector (attributes, rules, analysis) and the 3D viewport filling
the centre. Either sidebar collapses to 0 through a grab handle, and an
optional table panel can open under the viewport, so the model can take the
whole window for a projector. These four measures (toolbar height, status
height, left width, panel width) are the only spatial tokens; there is no
general spacing scale. Panels use 0.5rem to 0.75rem padding and 0.3rem to
0.5rem gaps between rows.

Density in the shell is high: type runs from 0.55rem badges to 0.9rem buttons,
most labels at 0.66rem to 0.75rem, controls at 2rem square. This is an observed
compression of the kit's scale for a workstation, not a second scale; anything
that leaves the shell (landing, modals, docs) returns to the kit's sizes.

The landing page is the exception in every dimension: a single 960px centred
column with 4rem top padding, 2rem gaps, the display headline, and an ambient
wash on the body (lime from the top left, blue from the bottom right, each a
13% tint about 1000px across) so the page reads as Roofy before the lockup does.

Overlays float inside the viewport, not over the panels: the legend card and
camera controls at the corners, the pick tooltip centred at the bottom, toasts
fixed 3rem above the bottom edge. Modals are `min(100%, 30rem)` wide.

Responsiveness is minimal and desktop-first: the one media query (640px) only
relaxes the landing headline. The shell has no mobile layout; the body sets a
320px minimum width.

## Elevation & Depth

Depth is tonal and linear, not cast. The shell is flat: root, panel, toolbar
and raised are four steps of the same near-black, separated by 1px hairlines
rather than shadows. Hover raises a row one tonal step (panel to raised);
selection adds the lime wash and a lime hairline. Nothing in the shell has a
shadow at rest.

Glass is the second layer and belongs only to things floating over the 3D
view: Night Glass at 85% to 90% with a 12px backdrop blur (8px on the small
camera buttons), edged with the strong hairline so the blur reads as a card and
not a smear. On the light theme the same elements use white at 92%.

Shadows exist for the third layer only, things that float over the whole
window.

### Shadow Vocabulary

- **Menu** (`box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4)`): dropdown menus and pop-over panels from the toolbar.
- **Modal** (`box-shadow: 0 18px 48px rgb(0 0 0 / 45%)`): dialogs, with the strong hairline and the 14px radius.
- **Sheet** (`box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25)` to `0.28`): small floating sheets such as the solar scrubber; `0.1` on the light theme.
- **Glow** (`box-shadow: 0 0 6px var(--accent)`): the one coloured shadow, on the live status dot.

### Named Rules

**The Three Layers Rule.** Shell is flat and hairlined; anything over the viewport is glass; anything over the window carries a shadow. A component never mixes two of these.

## Shapes

Rounded, small and consistent. The kit's radius scale is 6 / 9 / 14 / 20px
plus 18px for the app icon tile and 999px for pills. The shell uses 6px on
almost everything (buttons, inputs, rows, tabs) and 9px on cards, glass
overlays and the larger landing buttons; 14px marks a modal and 20px the
drop-zone. Dashed 2px strong hairlines outline drop targets. Status dots are
0.4rem circles; the streaming badge is a lime-outlined pill at 0.55rem.
Borders are always 1px hairlines except the 2px dashed drop-zone and the 2px
tab underline. The mark itself is flat geometry at 45° and is never rotated,
recoloured per plane or given an effect.

## Components

### Buttons

- **Character:** precise and quiet. Small, tight, one filled lime button per view; everything else is transparent until touched.
- **Shape:** 6px in the shell, 9px for the landing and picker buttons.
- **Primary:** Meadow Lime fill, Night Ink text, Outfit 600. Landing and picker size 0.5rem 1.25rem at 0.9rem; compact shell size 0.25rem 0.5rem at 0.7rem (rule save) or 0.3rem 0.75rem at 0.8rem (snapshot).
- **Hover:** fill steps to Lime Soft over 0.15s. Compact buttons dim to 90% opacity instead.
- **Ghost:** transparent, 1px hairline, muted ink, 0.7rem; cancel and secondary actions.
- **Icon (toolbar):** 2rem square, no border, muted ink; hover paints Night Raised and full ink; active paints Lime Wash with lime ink. Icons are 1rem line SVGs.
- **Glass (viewport):** 1.85rem square, Night Glass at 70% with 8px blur, strong hairline; camera controls.
- **Segmented (scope, view mode):** transparent siblings in one hairline box; the active one takes Lime Wash and lime ink.
- **Disabled:** reduced opacity, no hover; the Measure and Box Select tools ship this way.
- **Focus:** most controls rely on the browser's focus ring; the scene theme options set a 2px lime outline inset 1px. Inputs replace the outline with a lime border. Treat a visible focus state as required, not optional.

### Chips

- **Streaming badge:** lime outlined pill, 0.55rem, 600 weight, 0.03em tracking, lime text; marks a FlatCityBuf layer.
- **Geo badge:** the same shape for overlay layers.
- **Status values:** mono, muted ink; `.accent` turns a value lime when it is live.

### Cards / Containers

- **Corner Style:** 9px.
- **Background:** Night Raised on Night Panel (catalog cards), Night Glass over the viewport (legend, tooltip).
- **Shadow Strategy:** none inside the shell; see Elevation.
- **Border:** hairline; strong hairline on glass.
- **Internal Padding:** 0.7rem on cards, 0.5rem 0.6rem on the legend, 0.4rem 0.75rem on the tooltip.
- **List rows** (layers, rules, surfaces): hairline box at 6px, 0.35rem 0.5rem, 0.75rem text; hover raises the tone; the active row takes a lime hairline and Lime Wash.

### Inputs / Fields

- **Style:** Night Input fill, hairline border, 6px radius, 0.3rem 0.4rem padding, 0.72rem, inherits the UI face. Selects match.
- **Focus:** border becomes Meadow Lime; no outline.
- **Placeholder:** Night Ink Dim.
- **Error / Disabled:** no distinct error styling exists yet; disabled follows the button rule.

### Navigation

- **Toolbar:** Night Toolbar with a bottom hairline, 0.75rem gaps, the lockup at 0.9375rem with a 20px mark on the left, icon buttons, the sun trigger and theme toggle.
- **Tabs (inspector, modal):** Outfit 500 at 0.78rem, dim or muted ink, a 2px transparent underline that turns lime and the text full ink when active; modal tabs pull the underline 1px down to sit on the container's border.
- **Status bar:** mono 0.7rem, 1rem gaps, dots for state, right padding clearing the engine's attribution badge, which is always shown.
- **Mobile:** none; the shell is desktop-only.

### Legend Card (signature)

A glass card at the viewport corner: a mono uppercase title, then one row per
rule with a colour swatch and a short name. It is the place where the four
rooftop hues are explained, and it auto-shows when a rule is active. The toggle
that hides it shares the glass treatment.

### Lockup (signature)

`RoofyLockup` renders the mark as inline SVG with its four fills bound to the
layer tokens, so it follows the theme with no JavaScript, beside the wordmark in
Outfit 600. Gap 0.375em, mark 1.15em, 20px in the toolbar, 1.5rem type on the
landing hero.

## Do's and Don'ts

### Do:

- **Do** derive every interactive colour from the brand tokens in `src/app/brand.css`; `app.css` maps them to roles and never restates a hex.
- **Do** set panel section titles as IBM Plex Mono, 500, uppercase, 0.16em tracking, muted ink.
- **Do** keep a single filled lime button per view, Outfit 600, dark ink, the same in both themes.
- **Do** use Lime Wash plus a lime hairline for the active row, tab or tool, and step hover one tone up (panel to raised).
- **Do** use Night Glass with a 12px blur, edged with the strong hairline, for anything floating over the 3D view.
- **Do** keep the four rooftop hues in legend order (nature, energy, social, water) wherever they appear together.
- **Do** use Night Ink Muted (5.8:1) or Night Ink Label for any text that must be read; both themes pass AA on every surface.

### Don't:

- **Don't** use Night Ink Dim or Paper Ink Dim as the only ink of a readable label; at 3:1 it fails AA for text. The incumbent tabs, scope buttons and table captions do this and are on record as a defect, not a pattern.
- **Don't** set Noon Amber or Meadow Lime Deep as running text on the light theme; both fall below 3:1 on white.
- **Don't** give a rule preset, legend entry, default geo colour or base surface the selection lime (#a7e32b) or the hover lime (#cdf176).
- **Don't** add a shadow to anything inside the shell, or a blur to anything outside the viewport.
- **Don't** recolour individual planes of the mark, rotate it, add effects, or re-case the wordmark.
- **Don't** write globe colour or wireframe from the UI; the engine freezes. Only the elevation colormap is a clean setter.
- **Don't** hide or gate the geoid attribution overlay; it is a licence obligation.
- **Don't** introduce a font, a hue outside the brand set, or a second accent. Variation happens in hierarchy, density and layout, not identity.
