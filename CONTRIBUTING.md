# Contributing to DZQL

## Getting Started

### Prerequisites

- **Bun** v1.0.0 or later
- **Docker** (the tests run against PostgreSQL in a container)
- **Git**

### Clone and Setup

```bash
git clone https://github.com/blueshed/dzql.git
cd dzql
bun install

# Run the tests: starts a fresh PostgreSQL container, runs everything, tears it down
cd packages/dzql
bun run test
```

### Repository Structure

```
dzql/
├── packages/
│   ├── dzql/          # The dzql package on npm: compiler, runtime, client
│   │   ├── src/       # cli/ (compiler), runtime/, client/
│   │   ├── docs/      # User and AI documentation (published with the package)
│   │   ├── examples/  # Example domains (blog, venues)
│   │   └── tests/     # Unit tests, and integration tests against PostgreSQL
│   └── create-dzql/   # Starter template for `bun create dzql`
└── README.md
```

## Development Workflow

We use **test-driven development**: write a failing test, make it pass, then
refactor. Integration tests follow the patterns in
`packages/dzql/tests/integration/` and check what every user is allowed to do,
not only the user a feature is for.

When working with an AI assistant, point it at
[packages/dzql/docs/for_ai.md](packages/dzql/docs/for_ai.md) and `CLAUDE.md`.

## Testing

```bash
cd packages/dzql
bun run test                 # everything, with a fresh database
bun test tests/paths.test.ts # one file (start the database first: docker compose up -d --wait)
bunx tsc --noEmit            # type check
```

- **Unit tests** (`tests/*.test.ts`) need no database.
- **Integration tests** (`tests/integration/`) load the SQL the compiler generates
  into PostgreSQL and call it.

Before releasing a change to the template or the runtime, also test a real app
built from the local template (see `CLAUDE.md`).

## Submitting Changes

- Branch from `main` with a descriptive name (`fix/permission-path-parsing`).
- Use conventional commit messages (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Before opening a pull request: tests pass, `tsc` is clean, docs are updated.

## Publishing

Publishing is done by GitHub Actions when a tag is pushed. Don't publish by hand.

1. Update the version in `packages/dzql/package.json` and in
   `packages/create-dzql/package.json` (its own version and its `dzql`
   dependency). The two packages keep the same version number.
2. Commit and push.
3. Tag and push the tag: `git tag dzql@X.Y.Z && git push origin dzql@X.Y.Z`
   (and `create-dzql@X.Y.Z` for the template).

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
