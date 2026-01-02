# CLAUDE.md - Rules for Working on DZQL

## Read the Documentation First

Before working on this codebase, read:
- `packages/dzql/docs/for-ai/claude-guide.md` - **Comprehensive AI guide for this codebase**
- `tests/README.md` - Test infrastructure and patterns
- `tests/STATUS.md` - Current test status

## Publishing Rules

**NEVER publish without testing the actual feature you are working on.**

1. Write an integration test that tests the feature end-to-end against the real database
2. Run that specific test and verify it passes
3. Run the full test suite with `bun run test`
4. Ask the user for approval before publishing
5. Only publish after explicit approval

Making existing tests pass is NOT the same as testing the feature.

## Testing

- Use `bun run test` to run the test suite (not `bun test` directly)
- Tests run against a Docker PostgreSQL container (see `tests/compose.yml`)
- Write meaningful integration tests that hit the database
- Follow the patterns in `tests/integration/auth.test.js`
- Use test helpers from `tests/setup/test-helpers.js`

## Commands

- `bun run test` - Run all tests (starts Docker container automatically)

## Publishing

Publishing is done via GitHub Actions, triggered by git tags. Do NOT publish directly.

**To publish a new version:**

1. Update version in the package's `package.json`
2. Commit the changes
3. Create and push a git tag:
   ```bash
   git tag dzql@0.6.4   # or tzql@0.1.0, create-dzql@0.1.0
   git push origin dzql@0.6.4
   ```
4. GitHub Actions will automatically publish to npm using OIDC trusted publishing

**Tag format:** `<package-name>@<version>` (e.g., `dzql@0.6.5`, `create-dzql@0.6.5`)

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
