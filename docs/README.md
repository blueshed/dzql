# DZQL Repository Documentation

This directory contains **contributor and developer documentation** for the DZQL repository.

**Looking for user documentation?** See [`packages/dzql/docs/`](../packages/dzql/docs/)

## Contents

### Development
Guides for contributing to DZQL development:
- [TDD Workflow](development/TDD_WORKFLOW.md) - Test-driven development process
- [WebSocket Testing](development/WEBSOCKET_TESTING.md) - Testing WebSocket functionality
- [Claude Web Setup](development/CLAUDE-WEB.md) - Using PostgreSQL and Bun in Claude Web
- [Testing Report](development/TESTING_REPORT.md) - v0.2.0 testing methodology

### Architecture
Design documents and system architecture:
- [Permissions System](architecture/PERMISSIONS.md) - Path DSL grammar and permission model
- [Project Roadmap](architecture/ROADMAP.md) - Development roadmap and future plans
- [Canonical Stores](architecture/CANONICAL-STORES-SUMMARY.md) - Pinia store patterns

### Examples
Example implementations and patterns:
- [DaisyUI Integration](examples/daisyui.md) - UI component examples
- [Three Panel Layout](examples/three-panels.md) - Layout patterns
- [Bootstrap SQL](examples/dzql_bootstrap_skeleton.sql) - Database bootstrap example

## For Contributors

- See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines
- See [CHANGELOG.md](../CHANGELOG.md) for release history
- For user-facing documentation, see [`packages/dzql/docs/`](../packages/dzql/docs/)

## Documentation Standards

- Keep contributor/developer docs here in `/docs/`
- Keep user-facing docs in `/packages/dzql/docs/` (published to npm)
- Update links when moving files
- Add entry to this README when adding new docs
