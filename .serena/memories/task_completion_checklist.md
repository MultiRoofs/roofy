# Task Completion Checklist

When a task is completed, run the following steps:

1. **Tests**: `npm test` — Ensure all tests pass.
2. **Linting**: `npm run lint` — No ESLint errors.
3. **Formatting**: `npm run format:check` — Code is properly formatted. Run `npm run format` if needed.
4. **Build**: `npm run build` — TypeScript compiles and Vite builds without errors.

## Development Workflow (TDD)

1. Write a focused unit test first.
2. Run it, confirm it fails for the right reason.
3. Implement the smallest change to make it pass.
4. Refactor while keeping tests green.
5. Repeat.

## Code Review

After completing meaningful work, request a code review before committing:

- Check code quality, architecture alignment, test coverage, type safety
- Fix all Critical and Important issues before committing
- Minor issues may be deferred but should be tracked
