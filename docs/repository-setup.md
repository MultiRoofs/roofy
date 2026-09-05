# Repository Setup

Status: Proposed

## Purpose

This document describes the target repository structure and the conventions that should guide implementation once application work begins.

## Target Structure

The repository does not need all of these folders on day one, but this is the intended layout to grow into:

```text
multiroof-viewer/
  .devcontainer/
    devcontainer.json
    post-create.sh
    install-claude-plugins.sh
  docs/
    design-doc.md
    roadmap.md
    repository-setup.md
  public/
  src/
    app/
    domain/
      citymodel/
    features/
    scene/
    analytics/
    persistence/
    platform/
    shared/
  tests/
```

## Directory Responsibilities

### `.devcontainer`

Reproducible development environment configuration for VS Code or compatible devcontainer tooling. This layer should provision the current TypeScript workspace cleanly while leaving room for future Rust, wasm, and Tauri-adjacent tooling.

### `src/app`

Application bootstrap, providers, routing, dependency wiring, and workspace-level composition.

### `src/domain`

Pure data structures and domain logic for city models, buildings, roof surfaces, rules, and analysis outputs.

### `src/domain/citymodel`

Format-agnostic city-model abstractions plus encoding-specific adapters and readers.

### `src/features`

User-facing workflows such as city-model loading, rule authoring, selection inspection, and saved workspaces.

### `src/scene`

Three.js runtime, view controls, picking, layers, and scene graph composition.

### `src/analytics`

Geometry-derived metrics, suitability logic, solar helpers, and DuckDB-oriented analytical transforms.

### `src/persistence`

Interfaces and concrete implementations for local save, restore, and share-state codecs.

### `src/platform`

Adapters for browser-specific and future Tauri-specific integrations.

### `src/shared`

Reusable utilities, UI primitives, constants, and low-level helpers that do not belong to a single feature.

## Architectural Conventions

- Keep rendering code out of persistence modules.
- Keep DuckDB query logic out of view components.
- Keep file-format parsing isolated from feature components.
- Keep `citymodel` as the conceptual naming layer, and treat CityJSON, CityJSONSeq, and FlatCityBuf as encodings.
- Prefer pure domain functions for analysis logic so they are testable without a scene runtime.
- Route persistence access through interfaces and injection rather than importing local storage directly in UI code.

## Recommended Initial Tooling Scope

When implementation begins, the first tooling baseline should cover:

- `vite` for local development and production build
- `typescript` for typed boundaries
- `eslint` for linting
- `prettier` or an equivalent formatter
- `vitest` for unit tests in a TDD workflow
- simple unit testing for pure analysis, ingestion, and persistence logic
- a repository-scoped devcontainer for reproducible onboarding and toolchain setup

## Development Container Direction

The repository should provide a devcontainer as a convenience layer for consistent onboarding and cross-machine setup.

Initial expectations:

- Node LTS for the Vite, React, Vitest, and ESLint workflows used today
- Rust tooling kept available for future Tauri, wasm, and native helper experiments
- system packages needed for native module builds
- post-create bootstrap for project dependencies and common CLI tools
- editor defaults aligned with the current repository formatter and linting setup

## State Management Direction

The application should maintain a single workspace-level state model, but implementation details should stay replaceable. The most important decision is not the specific state library; it is preserving clear boundaries between:

- ephemeral UI state
- persisted project state
- derived analytical state
- shareable URL state

## Persistence Direction

Planned v1 implementations:

- in-memory state for transient sessions
- local storage for saved workspaces
- URL codec for compact shared views

Future-compatible abstractions should make it straightforward to add:

- server-backed project persistence
- database storage
- Tauri-native file or local database persistence

## Recommended Coding Strategy

- Build one vertical slice at a time.
- Introduce typed contracts before concrete adapters.
- Write a failing unit test first, then implement the smallest change to pass it, then refactor.
- Use a small sample city-model fixture while developing the first end-to-end flows.
- Keep geospatial assumptions explicit in code and docs.

## Definition of Done for Early Features

- The feature works with at least one sample city-model fixture.
- The feature state can be serialized if it belongs to persisted workspace state.
- The feature does not leak storage or parsing concerns into UI components.
- The feature includes at least minimal documentation when it changes architecture.

## Preview deployments (Cloudflare Workers)

Production is the `multiroof-viewer` Worker, deployed by `.github/workflows/deploy.yml`
on every push to `main`. Previews come from `.github/workflows/preview.yml`:

- **When**: every pull request from this repository (forks have no secrets), every
  push to `develop`, or by hand (`workflow_dispatch`).
- **What**: `npm run build`, then `wrangler versions upload --preview-alias <branch>` —
  an _undeployed_ version of the same Worker. Production traffic never reaches it.
- **Where**: two URLs, both printed by wrangler and posted as a sticky comment on the
  pull request (and in the run summary):
  - `<version-prefix>-multiroof-viewer.<account>.workers.dev` — this commit only;
  - `<branch>-multiroof-viewer.<account>.workers.dev` — stable for the branch
    (the branch name made DNS-safe: lowercase, dashes, starts with a letter).
- **Secrets**: the same three `deploy.yml` uses — `CLOUDFLARE_API_TOKEN` (Workers
  Scripts: Edit), `CLOUDFLARE_ACCOUNT_ID`, `DOTENV_PRIVATE_KEY`.
- **Config**: `wrangler.jsonc` sets `workers_dev: true` and `preview_urls: true`
  explicitly. If Preview URLs are toggled in the dashboard, the next wrangler run
  resets them to the file's value.
- **Locally**: `npm run build && npx wrangler versions upload --preview-alias me`
  after `npx wrangler login`.
- **Promote**: previews are never promoted directly; merge to `main` and `deploy.yml`
  builds and deploys it.
