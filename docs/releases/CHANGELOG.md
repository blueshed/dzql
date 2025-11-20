# Changelog

All notable changes to DZQL will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2025-11-20

### Added

#### Custom Function Pass-through
- **Compiler** now automatically extracts and includes custom SQL functions defined after `register_entity()` calls
- Eliminates manual duplication - define functions once in entity files
- Supports `CREATE FUNCTION`, `INSERT INTO dzql.registry`, and `SELECT dzql.register_function()`
- Functions stay with their related entities
- Single source of truth for entity-related custom logic

#### Field Defaults
- New 10th parameter `p_field_defaults` in `register_entity()`
- Auto-populate fields during INSERT operations (not UPDATE)
- Supports variables: `@user_id`, `@now`, `@today`
- Supports literal default values (e.g., `"draft"`, `0`, `true`)
- Explicit values override defaults
- Added `field_defaults` column to `dzql.entities` table
- Reduces client boilerplate and prevents common errors
- Improves security by server-controlling sensitive defaults

#### Many-to-Many Relationships
- First-class M2M support via `graph_rules.many_to_many` configuration
- Automatic junction table synchronization in single atomic transaction
- Single API call for entity + relationships (eliminates N+1 queries)
- ID arrays always included in responses (e.g., `tag_ids: [1, 2, 3]`)
- Optional full object expansion with `expand` flag (default: `false` for performance)
- M2M expansion in `save_*`, `get_*`, and `search_*` operations
- Added `many_to_many` column to `dzql.entities` table
- Handles empty arrays (remove all), null/omitted (no change)
- Proper type casting for junction table queries

### Changed
- **Schema**: `dzql.entities` table now has `field_defaults` and `many_to_many` columns
- **API**: `dzql.register_entity()` signature extended with 10th parameter
- **Compiler**: `EntityParser` now extracts custom functions, field defaults, and M2M configs
- **Runtime**: `generic_save()` applies field defaults and syncs M2M junction tables
- **Runtime**: `generic_get()` expands M2M relationships based on configuration
- **Runtime**: `generic_search()` expands M2M relationships in result arrays
- **Validation**: `dzql.validate_graph_rules()` skips `many_to_many` key (different structure)
- **INSERT/UPDATE**: M2M ID fields automatically excluded from database operations

### Documentation
- Added `docs/guides/field-defaults.md` - Complete guide with use cases
- Added `docs/guides/custom-functions.md` - Patterns and best practices
- Added `docs/guides/many-to-many.md` - Comprehensive M2M documentation
- Updated `docs/reference/api.md` - New parameters, M2M config, complete examples
- Added `docs/plan.md` - Implementation plan and progress tracking
- Added `docs/IMPLEMENTATION_SUMMARY.md` - Technical implementation details

### Tests
- Added `tests/compiler/custom-functions.test.js` - Parser-level tests
- Added `tests/compiler/field-defaults.test.js` - Parser-level tests
- Added `tests/compiler/many-to-many.test.js` - Parser-level tests
- **Demo**: Added `packages/venues/tests/brands-tags-m2m.test.js` - 10 integration tests
- **Demo**: Added `packages/venues/database/init_db/011_brands_tags.sql` - M2M example
- **All 103 tests passing** (10 new M2M + 93 existing)

### Performance
- M2M with `expand: false` - Single query per record (fast, default)
- M2M with `expand: true` - Additional JOIN per relationship (use for detail views only)
- Field defaults - Negligible overhead (one-time resolution at INSERT)

### Breaking Changes
**None** - All features are opt-in and backwards compatible.

### Migration Guide
1. Update package: `bun update dzql`
2. Restart database container (migrations run automatically)
3. Optionally add new features to entity registrations
4. No changes required to existing entities

See implementation details in `docs/IMPLEMENTATION_SUMMARY.md`.

## [0.2.3] - 2025-01-19

### Changed
- **Client**: Made JWT token localStorage key configurable in `WebSocketManager`
  - Added `tokenName` option to constructor (defaults to `'dzql_token'`)
  - Removed hardcoded `"dzql_token"` literal from ws.js:269
  - Example: `new WebSocketManager({ tokenName: 'my_custom_token' })`
  - Backwards compatible - existing code continues to work with default value

## [0.2.1] - 2025-11-18

### Fixed
- **Compiler**: Fixed permission path evaluation for subscribables with direct field references (`@owner_id`)
  - Permission functions now correctly fetch entity data when checking direct field permissions
  - Added proper table alias to entity queries
  - Handles both `direct_field` and `field_ref` AST types

### Changed
- **Testing**: Migrated all tests to `bun:test` framework
  - Moved subscription tests from standalone scripts to proper test suite
  - Organized tests into `/tests/subscriptions/` directory
  - Created `TestDatabase` utility for isolated test databases
  - All tests now use `postgres` package instead of `pg`

### Added
- **Documentation**: Moved subscription docs to `packages/dzql/docs/` for npm publishing
- **Testing**: Added `tests/test-utils/` with Docker Compose setup and test database utilities

## [0.2.0] - 2025-01-17

### Added
- **Live Query Subscriptions (Pattern 1)** - Major new feature
  - PostgreSQL-first architecture for real-time denormalized documents
  - Client subscribes to complex documents and receives automatic updates
  - Three-function pattern per subscribable:
    - `<name>_can_subscribe(user_id, params)` - Permission check
    - `get_<name>(params, user_id)` - Query builder
    - `<name>_affected_documents(table, op, old, new)` - Change detection
  - In-memory subscription registry on server
  - Pattern matching on `subscribe_*` and `unsubscribe_*` method names
  - Zero server configuration needed for new subscribables

- **Subscription Compiler**
  - `subscribable-parser.js` - Parse subscribable definitions from SQL
  - `subscribable-codegen.js` - Generate PostgreSQL functions
  - CLI tool: `compile-subscribable.js`

- **Database Schema**
  - Migration `009_subscriptions.sql`
  - `dzql.subscribables` table for metadata
  - `dzql.register_subscribable()` function

- **Server Integration**
  - `subscriptions.js` - In-memory subscription management
  - WebSocket handlers for subscribe/unsubscribe operations
  - Event listener integration for real-time updates
  - Automatic cleanup on disconnect

- **Client API**
  - `ws.api.subscribe_<name>(params, callback)` - Subscribe with callback
  - `ws.api.unsubscribe_<name>(params)` - Unsubscribe
  - Automatic update delivery via callbacks
  - Returns `{ data, subscription_id, unsubscribe }` object

- **Documentation**
  - Complete subscription guide at `packages/dzql/docs/guides/subscriptions.md`
  - Quick start guide at `packages/dzql/docs/getting-started/subscriptions-quick-start.md`
  - Updated API reference with subscription examples
  - Strategy document at `docs/architecture/SUBSCRIPTIONS_STRATEGY.md`

### Performance
- Subscription compilation: 1-3ms per subscribable
- Query execution: Sub-millisecond for simple documents
- In-memory registry: ~200 bytes per subscription
- Change detection: Constant-time lookup with proper indexes

### Migration Required
- Run `009_subscriptions.sql` migration
- No breaking changes to existing code

## [0.1.6] - 2025-01-16

### Added
- Canonical Pinia stores for Vue.js integration
- Client store templates at `src/client/stores/`
- Export `./client/stores` and `./client/templates` in package

### Fixed
- Graph rules bug in relationship handling

## [0.1.5] - 2025-01-15

### Changed
- Include `docs/**/*.md` in published npm package
- Documentation now available to npm users

## [0.1.4] - 2025-01-14

### Fixed
- Test file path resolution using `import.meta.url`
- Improved compatibility across different environments

## [0.1.3] - 2025-01-13

### Added
- Complete DZQL compiler with password authentication
- Comprehensive test suite for compiled SQL functions
- Permission system with row-level security
- Graph rules for automated relationship management

### Documentation
- Added compiler documentation
- Coding standards and best practices
- Advanced filter operators guide

## Earlier Versions

See git history for changes in versions 0.1.0-0.1.2.

---

## Versioning Policy

- **Major** (X.0.0): Breaking changes to public API
- **Minor** (0.X.0): New features, backwards compatible
- **Patch** (0.0.X): Bug fixes, backwards compatible

## Links

- [Roadmap](docs/architecture/ROADMAP.md)
- [Contributing](CONTRIBUTING.md)
- [Full Release Notes](docs/) - Detailed release notes in `/docs/RELEASE_NOTES_*.md`
