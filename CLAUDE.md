# CLAUDE.md - Rules for Working on DZQL

## Read the Documentation First

Before working on this codebase, read:
- `packages/dzql/docs/for-ai/claude-guide.md` - **Comprehensive AI guide for this codebase**

## Project Structure

```
packages/
├── dzql/          # Core runtime (published as 'dzql')
│   ├── src/       # Server, client, database migrations
│   ├── docs/      # Documentation
│   └── tests/     # Integration tests
├── tzql/          # TypeScript compiler (CLI is 'dzql')
└── create-dzql/   # Starter template (bun create dzql)
```

## Testing

- Run tests: `cd packages/tzql && bun run test`
- Tests run against Docker PostgreSQL (see `packages/tzql/compose.yml`)
- Follow patterns in `packages/tzql/tests/integration/`
- The test script handles Docker lifecycle: starts fresh, runs tests, tears down

**Test-Driven Development:** Write tests first. Add failing tests for new features or bugs, then implement until they pass. This ensures the feature works and prevents regressions.

**End-to-End Verification:** Before publishing, always test in a real app (like the berty sample at `/Users/peterb/Workshop/berty`). Unit tests passing does not guarantee the feature works end-to-end. Use Playwright to verify real-time features like subscriptions actually work in the browser.

## Publishing

Publishing is done via GitHub Actions, triggered by git tags. Do NOT publish directly.

**To publish a new version:**

1. Update version in the package's `package.json`
2. Commit the changes
3. Create and push a git tag:
   ```bash
   git tag dzql@0.6.9
   git push origin dzql@0.6.9
   ```
4. GitHub Actions will automatically publish to npm using OIDC trusted publishing

**Tag format:** `<package-name>@<version>` (e.g., `dzql@0.6.9`, `create-dzql@0.6.9`)

**Version sync:** `dzql` and `create-dzql` should always have the same version number.

## Events

Events only have `pk` and `data`. There is no `before`/`after` or `old`/`new`.

- INSERT: `data` contains the new row
- UPDATE: `data` contains the updated row
- DELETE: `data` contains the deleted row (needed for subscription resolution)

## Subscribables

The `_affected_documents` function signature is:
```sql
function_name_affected_documents(p_table_name TEXT, p_op TEXT, p_data JSONB)
```

Three parameters. Not four.

## Listen to the User

If the user tells you something, do it. Don't revert to old patterns. Don't publish without permission. Don't claim tests prove functionality when they don't.
