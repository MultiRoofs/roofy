<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/urbis-mark.svg">
    <source media="(prefers-color-scheme: light)" srcset="public/brand/urbis-mark-light.svg">
    <img alt="" src="public/brand/urbis-mark-light.svg" width="72" height="72">
  </picture>
</p>

<h1 align="center">Urbis</h1>

<p align="center"><strong>Your city, in 3D.</strong><br>
A browser-based 3D city model viewer and analyser, rendered on a real globe with photorealistic terrain.</p>

<p align="center">Use the deployed app at <strong><a href="https://urbis.open3d.city">urbis.open3d.city</a></strong></p>

<!-- The lockup SVGs set the wordmark as live text in IBM Plex Sans, which GitHub's
     sandboxed image rendering cannot load — so the README follows the brand kit's
     rule for font-unguaranteed contexts: bare mark + real text. -->

## What it does

- **Loads real city model data**: CityJSON (1.x and 2.x), CityJSONSeq, streaming FlatCityBuf, CityParquet, and zipped CityGML archives — from local files, URLs, cloud buckets, or the built-in [Open3D City](https://open3d.city) STAC catalog browser.
- **Georeferences properly**: every vertex is projected from its source CRS through proj4 (worldwide EPSG resolution) onto WGS84 ENU frames, with EGM2008 geoid-corrected heights — models wrap Google's Photorealistic 3D Tiles to metre accuracy.
- **Colours by your rules**: per-layer, attribute- or geometry-based rule styling with a legend, on static and streaming layers alike.
- **Simulates sun and shade** for any date and time, with a time-of-day animation.
- **Analyses in the browser**: DuckDB-wasm statistics over the loaded model — no backend, no login.
- **Saves and shares**: workspaces persist locally and share as URLs.

## Tech

React 19 + TypeScript + Vite · [Navara](https://github.com/reearth/navara) (`@navaramap/three`) on three.js · proj4 · DuckDB-wasm · Zustand · Vitest.
The CityJSON/FlatCityBuf/CityParquet engine plugins live in a submodule: [`cityjson-navara-plugins`](https://github.com/HideBa/cityjson-navara-plugins).

## Development

```bash
git clone --recursive git@github.com:MultiRoofs/multiroof-viewer.git
cd multiroof-viewer
npm install
(cd packages/cityjson-navara-plugins && pnpm install)
npm run dev        # via dotenvx — .env is encrypted, see CLAUDE.md
```

`npm run test` runs the app suite; the submodule has its own (`pnpm vitest run` inside it). See [CLAUDE.md](CLAUDE.md) for architecture notes and the full development guide.

## Documents

- [Design Doc](docs/design-doc.md)
- [Roadmap](docs/roadmap.md)
- [Repository Setup](docs/repository-setup.md)
- [Testing Strategy](docs/testing-strategy.md)
- [Agent Guide](agents.md)

## About

Urbis is developed within the MultiRoofs European project at TU Delft, with a product focus on rooftop-centric urban planning — but it is a general-purpose city model viewer first.

Licensed under the [MIT License](LICENSE).
