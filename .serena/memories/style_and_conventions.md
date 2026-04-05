# Code Style and Conventions

## TypeScript
- Strict mode enabled (`strict: true`, `noUncheckedIndexedAccess: true`)
- Target: ES2022
- Module: ESNext with Bundler resolution
- JSX: react-jsx

## Formatting (Prettier)
- Semicolons: yes
- Single quotes: no (double quotes)
- Trailing commas: all
- Indent: 2 spaces
- Line endings: LF
- Final newline: yes

## Linting (ESLint)
- Base: @eslint/js recommended + typescript-eslint recommended
- React hooks rules enforced
- react-refresh/only-export-components: warn (allowConstantExport)

## Naming & Structure
- Domain term: `citymodel` (not encoding-specific names)
- Tests mirror src structure under `tests/unit/` and `tests/integration/`
- Test files: `*.test.ts` or `*.test.tsx`
- Small, testable modules preferred over monoliths
- No domain logic in view components
- No coupling between DuckDB queries and Three.js scene code

## Design Patterns
- Persistence behind TypeScript interfaces + dependency injection
- Platform-specific code isolated in `src/platform/`
- Separate ingestion, rendering, analysis, persistence, UI concerns
