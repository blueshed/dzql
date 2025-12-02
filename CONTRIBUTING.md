# Contributing to DZQL

Thank you for your interest in contributing to DZQL! This document provides guidelines and information for contributors.

## Quick Links

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Documentation](#documentation)
- [Submitting Changes](#submitting-changes)

## Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Assume good intentions

## Getting Started

### Prerequisites

- **Bun** v1.0.0 or later (`npm install -g bun`)
- **PostgreSQL** 16 or later
- **Git** for version control

### Clone and Setup

```bash
# Clone the repository
git clone https://github.com/blueshed/dzql.git
cd dzql

# Install dependencies
cd packages/dzql
bun install

# Start test database
cd tests/test-utils
docker compose up -d

# Run tests
cd ../..
bun test
```

### Repository Structure

```
dzql/
├── packages/
│   ├── dzql/          # Core DZQL framework
│   ├── venues/        # Example application
│   ├── blog/          # Blog example
│   └── rights/        # Rights management example
├── docs/              # Contributor/developer documentation
└── README.md          # Project overview
```

## Development Workflow

We use **Test-Driven Development (TDD)** for all new features:

1. **Write a failing test** - Red phase
2. **Make it pass** - Green phase
3. **Refactor** - Improve code quality
4. **Commit** - Save your progress

See [TDD Workflow Guide](docs/development/TDD_WORKFLOW.md) for detailed instructions.

### Working with AI Assistants

DZQL is designed to work seamlessly with AI coding assistants like Claude:

1. **Describe** what you want to build
2. **Let the AI** write the implementation
3. **Test** the generated code
4. **Iterate** until tests pass

See [Claude Guide](packages/dzql/docs/for-ai/claude-guide.md) for AI assistant integration.

## Testing

### Running Tests

```bash
# All tests
bun test

# Specific test file
bun test tests/compiler/compiler.test.js

# Watch mode (great for TDD)
bun test --watch

# With coverage
bun test --coverage
```

### Test Structure

- **Unit Tests** (`tests/compiler/`) - Fast, no database required
- **Integration Tests** (`tests/subscriptions/`) - Require PostgreSQL
- **E2E Tests** (`packages/venues/tests/`) - Full stack testing

See [WebSocket Testing Guide](docs/development/WEBSOCKET_TESTING.md) for testing patterns.

### Writing Tests

Use the `bun:test` framework:

```javascript
import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { TestDatabase } from '../test-utils/db.js';

let db, sql;

beforeAll(async () => {
  db = new TestDatabase();
  sql = await db.setup();
});

afterAll(async () => {
  await db.teardown();
});

describe('My Feature', () => {
  test('does something', async () => {
    const result = await sql`SELECT 1 as value`;
    expect(result[0].value).toBe(1);
  });
});
```

## Documentation

### User Documentation

Location: `packages/dzql/docs/`

- **Getting Started** - Tutorials for new users
- **Guides** - Feature-specific how-tos
- **Reference** - API documentation
- **For AI** - AI assistant integration guides

These docs are published to npm with the package.

### Contributor Documentation

Location: `/docs/`

- **Development** - TDD workflow, testing guides
- **Architecture** - Design documents, roadmap
- **Examples** - Implementation patterns

### Documentation Standards

- Use clear, concise language
- Include code examples
- Keep related content together
- Update links when moving files
- Add entry to README when creating new docs

## Submitting Changes

### Branch Naming

Use descriptive branch names:

```
feature/live-query-subscriptions
fix/permission-path-parsing
docs/improve-getting-started
test/add-subscription-tests
```

### Commit Messages

Follow conventional commits:

```
feat: add live query subscriptions
fix: correct permission path evaluation
docs: update API reference
test: add subscription integration tests
chore: update dependencies
```

### Pull Request Process

1. **Create a branch** from `main`
2. **Make your changes** with tests
3. **Run tests** (`bun test`)
4. **Update documentation** if needed
5. **Commit your changes**
6. **Push to your fork**
7. **Open a pull request**

#### PR Checklist

- [ ] Tests pass (`bun test`)
- [ ] Documentation updated
- [ ] Commit messages are clear
- [ ] No unnecessary files included
- [ ] Code follows project style

### Review Process

- Maintainers will review your PR
- Address feedback
- Once approved, maintainers will merge

## Project-Specific Guidelines

### PostgreSQL-First Architecture

DZQL puts business logic in the database:

- **Write SQL functions** for complex logic
- **Use the compiler** to generate CRUD operations
- **Test with PostgreSQL** - don't mock the database
- **Leverage PostgreSQL features** (JSONB, triggers, etc.)

### Zero Boilerplate Philosophy

- Auto-generate repetitive code
- Convention over configuration
- Declarative over imperative
- Compile-time over runtime

### Performance Matters

- Keep hot paths fast (< 1ms)
- Use database indexes appropriately
- Minimize round trips
- Profile before optimizing

## Publishing

To publish a new version of the dzql package:

```bash
# 1. Commit all changes first
git add -A && git commit -m "fix: description of changes"

# 2. Bump version and publish from the PACKAGE directory (not root!)
cd packages/dzql
npm version patch  # or minor/major (bun doesn't have version command)
bun publish --access public

# 3. Commit and push the version bump
cd ../..
git add -A && git commit -m "v0.x.x" && git push
```

**Important**: The version lives in `packages/dzql/package.json`, NOT the root `package.json`. The root is for the monorepo workspace only.

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/blueshed/dzql/issues)
- **Discussions**: [GitHub Discussions](https://github.com/blueshed/dzql/discussions)
- **Documentation**: [packages/dzql/docs/](packages/dzql/docs/)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for contributing to DZQL!** 🚀

Your contributions help make database-driven applications easier to build for everyone.
