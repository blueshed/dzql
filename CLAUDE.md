# CLAUDE.md - Rules for Working on DZQL

## Read the Documentation First

Before working on this codebase, read:
- `packages/dzql/docs/for-ai/claude-guide.md` - **Comprehensive AI guide for this codebase**

## Project Structure

```
packages/
├── dzql/          # Legacy runtime (deprecated, kept for reference)
├── tzql/          # Main package (published as 'dzql' on npm)
│   ├── src/       # Compiler, runtime, client
│   └── tests/     # Integration tests
└── create-dzql/   # Starter template (bun create dzql)
```

## Testing

- Run tests: `cd packages/tzql && bun run test`
- Tests run against Docker PostgreSQL (see `packages/tzql/compose.yml`)
- Follow patterns in `packages/tzql/tests/integration/`
- The test script handles Docker lifecycle: starts fresh, runs tests, tears down

**Test-Driven Development:** Write tests first. Add failing tests for new features or bugs, then implement until they pass. This ensures the feature works and prevents regressions.

**End-to-End Verification:** Before publishing, always test in a real app. Unit tests passing does not guarantee the feature works end-to-end. Use Playwright to verify real-time features like subscriptions actually work in the browser.

### Testing the create-dzql Template

Before publishing changes to `create-dzql` or `tzql`, test by creating a sample app using the local template **with local packages linked**:

```bash
# 1. Link local dzql package globally
cd /Users/peterb/Workshop/blueshed/dzql/packages/tzql
bun link

# 2. Create test app from local template
cd /tmp
rm -rf dzql-test-app
bun /Users/peterb/Workshop/blueshed/dzql/packages/create-dzql/index.ts dzql-test-app
cd dzql-test-app

# 3. Link local dzql into the test app (uses local code, not npm published version)
bun link dzql

# 4. Install remaining dependencies
bun install

# 5. Compile and start database
bun run db:rebuild

# 6. Start dev servers
bun run dev
```

**IMPORTANT:** The `bun link dzql` step is critical - without it, `bun install` fetches the published npm version, not your local changes. Always verify you're testing local code, not the old published version.

**Verify local code is linked:** After `bun run db:rebuild`, check the generated manifest to confirm your changes are present:
```bash
cat .dzql/manifest.json | head -20
```

Then use Playwright (via MCP Docker) to test at `http://host.docker.internal:5173`:

1. **Register a user**: Click "Create one", fill name/email/password, submit
2. **Create a post**: Click "New Post", navigate to `/posts/new`, fill title/content, click Publish
3. **Verify real-time**: Post should appear in list immediately (no refresh needed)
4. **Edit a post**: Click "Edit" on your post, modify content, save - verify update appears
5. **Delete a post**: Click "Delete", confirm - verify post is removed from list

**Key things to verify:**
- Real-time updates work (posts appear/update/disappear without refresh)
- Edit button only shows for posts you authored
- Routes work: `/`, `/posts/new`, `/posts/:id/edit`

### Cleanup

**IMPORTANT:** Always clean up after E2E testing to avoid polluting your environment.

```bash
# 1. Kill dev servers first (vite processes left running in background)
pkill -f "vite" 2>/dev/null

# 2. Stop and remove test app
cd /tmp/dzql-test-app
docker compose down -v
cd /tmp && rm -rf dzql-test-app

# 3. Remove the global bun link
cd /Users/peterb/Workshop/blueshed/dzql/packages/tzql
bun unlink
```

The `bun unlink` step removes the global link so future projects use the published npm version, not your local code.

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

**Tag format:** `<package-name>@<version>` (e.g., `dzql@0.6.17`, `create-dzql@0.6.17`)

**Version sync:** `tzql` (published as `dzql`) and `create-dzql` should always have the same version number.

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
