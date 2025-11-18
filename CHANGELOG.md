# Changelog

All notable changes to DZQL will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
  - Complete subscription guide at `docs/LIVE_QUERY_SUBSCRIPTIONS.md`
  - Quick start guide at `docs/SUBSCRIPTIONS_QUICK_START.md`
  - Updated API reference with subscription examples
  - Strategy document for architecture decisions

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
