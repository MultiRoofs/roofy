---
name: Roofy
description: A restrained city-model workspace with compact controls and a map-centered hierarchy.
colors:
  lime: "#a7e32b"
  lime-light-theme: "#7cb518"
  accent-text-light: "#4a7a0f"
  amber: "#ffc530"
  terracotta: "#f2683c"
  blue: "#3b82f6"
  dark-root: "#0b0e13"
  dark-panel: "#12161e"
  dark-raised: "#1d222c"
  light-root: "#f6f7f2"
  light-panel: "#ffffff"
  light-raised: "#edefe7"
typography:
  workspace:
    fontFamily: '"Source Sans 3", system-ui, sans-serif'
    fontSize: "0.75rem"
    lineHeight: 1.5
  workspace-title:
    fontFamily: '"Source Sans 3", system-ui, sans-serif'
    fontSize: "0.8125rem"
    fontWeight: 600
rounded:
  workspace-small: "0px"
  workspace-medium: "0px"
  workspace-large: "0px"
---

# Design System: Roofy

## Overview

The map is the primary working surface. A compact header, layer controls, selection details and records surround it. The user's approved direction is professional and minimal: consistent typography, restrained shapes and spacing that expresses hierarchy.

This records the current map polish. The older Impeccable sidecar contains historical examples; current source and the user's latest direction take precedence over those examples.

## Colors

Lime marks interaction and selection. Amber, terracotta and blue retain existing rooftop and state meanings. Use semantic variables from brand.css and app.css, including accent-text for readable light-theme accent text. Interface appearance defaults to System, with Light and Dark overrides.

## Typography

The entire interface uses Source Sans 3 for headings, controls and data, with tabular numerals in the workspace. The workspace name uses 14px/500, selected in live mode. Normal controls use the workspace role; secondary information uses 11px and titles use the semibold title role. Avoid tracked uppercase monospace labels and oversized date/time fields.

The landing page and Roofy wordmark use the same Source Sans 3 family. Self-hosted weights 400, 500, 600 and 700 provide hierarchy without mixing fonts.

The workspace management page uses a 28px semibold page title and 14px body text; map controls retain the compact workspace scale.

## Layout

Keep the header above the map, layers on the left, selection details on the right, and records beneath the map column. The viewer retains its 1024px desktop minimum width and resizable panels.

Separate sections by 16–24px. Keep labels about 6px from fields and related actions 4–6px apart. Sun and scene settings use a fixed header above one scrolling body. Date and Time share one row. Long attributes wrap within the details panel.

At map widths below 560px, scene triggers and the selection camera action use compact icon treatments with accessible names. Keep the legend and camera controls separated.

## Elevation & Depth

Shell regions are opaque and separated by fine borders. Floating map controls and scene sheets use opaque, square surfaces. Preserve the landing page's existing ambient background.

## Shapes

Use square corners and no button shadows or visible button borders, following approved variant A (Flat list). Quiet solid fills distinguish actions; muted green fills mark selection. Keep the brand mark unchanged.

## Components

Scene sheets share mapSheet.css. Keep the header and close control visible during scrolling. Use themed native inputs, normal-sized time fields, visible focus states, and readable disabled states.

Active layer rows use a full-width opaque neutral selection fill without a border. Inline actions stay unboxed; hover and keyboard focus remain visible. Section disclosures use weight and spacing for hierarchy. Details have their own opaque surface and bounded attribute columns. Existing camera, selection and drawer behavior remains intact.

## Do's and Don'ts

- Do follow src/app/workspace.css and docs/map-workspace-polish.md for the polished map workspace.
- Do preserve accessible names when labels collapse, keyboard focus, and attribution access.
- Do keep all controls reachable as panels open and the map narrows.
- Don't reintroduce decorative display typography into workspace controls.
- Don't use one uniform gap for section boundaries and detailed controls.
- Don't let nested scrolling containers clip sheet headers or cover camera controls.
