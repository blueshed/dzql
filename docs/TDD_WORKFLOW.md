# DZQL Test-Driven Development Workflow

## Environment Setup

Claude Code runs in a sandboxed container without Docker access. To enable TDD:

### Prerequisites (on your local machine)
- Docker and Docker Compose installed
- Bun runtime installed
- DZQL repository cloned

## TDD Workflow

### 1. Start Database (Terminal 1)
```bash
cd ~/Workshop/dzql/packages/rights
bun db:up
# Database runs on localhost:5433
```

### 2. Run Tests in Watch Mode (Terminal 2)
```bash
cd ~/Workshop/dzql/packages/rights
bun test --watch
```

### 3. TDD Cycle with Claude Code

**RED Phase (Write Failing Test):**
- Tell Claude: "Write a test for [feature]"
- Claude writes the test
- Verify test fails locally ✗

**GREEN Phase (Implement Feature):**
- Tell Claude: "Implement [feature]"
- Claude writes the implementation
- Verify test passes locally ✓

**REFACTOR Phase:**
- Tell Claude: "Refactor [code]"
- Claude improves the code
- Verify tests still pass ✓

**COMMIT Phase:**
- Tell Claude: "Commit the changes"
- Claude commits and pushes

## Available Test Suites

### Rights Package (Composite Key Testing)
```bash
cd packages/rights
bun test                    # Run once
bun test --watch           # Watch mode
```

### Venues Package (Core DZQL Features)
```bash
cd packages/venues
bun test                    # Run once
bun test tests/specific.test.js  # Run specific test
```

### DZQL Core (Framework Tests)
```bash
cd packages/dzql
bun test
```

## Database Management

```bash
# Start database
bun db:up

# Stop and remove database (clean slate)
bun db:down

# Restart database (applies latest migrations)
bun db:down && bun db:up

# View logs
bun db:logs

# Access Adminer (database GUI)
open http://localhost:8081
# Server: postgres:5433
# User: dzql
# Password: dzql
# Database: dzql
```

## Migration Workflow

When Claude modifies SQL migrations:

```bash
# 1. Stop database
bun db:down

# 2. Start fresh (runs all migrations)
bun db:up

# 3. Run tests
bun test
```

## Testing Specific Features

### Example: Testing Composite Primary Keys
```bash
cd packages/rights
bun db:up
bun test tests/basic.test.js
```

### Example: Testing Permissions
```bash
cd packages/venues
bun db:up
bun test tests/permissions.test.js
```

### Example: Testing Graph Rules
```bash
cd packages/venues
bun db:up
bun test tests/graph_rules.test.js
```

## Troubleshooting

### Database Connection Issues
```bash
# Check if database is running
pg_isready -h localhost -p 5433

# Check running containers
docker ps | grep postgres

# View database logs
cd packages/rights
bun db:logs
```

### Test Failures After Migration Changes
```bash
# Always restart database after migration changes
bun db:down && bun db:up
bun test
```

### Port Already in Use
```bash
# Kill existing database
bun db:down

# Or change port in database/compose.yml
# Then: bun db:up
```

## Communication with Claude Code

### Starting a TDD Session
```
You: "Let's implement [feature] using TDD. I have the database running."
Claude: "Great! I'll write the test first. Here's the failing test..."
You: [Run test locally, confirm it fails]
You: "Test fails as expected. Implement it."
Claude: "Here's the implementation..."
You: [Run test locally, confirm it passes]
You: "Test passes! Commit the changes."
```

### Example TDD Session
```
You: "Add support for venue capacity limits using TDD"
Claude: [Writes test that expects capacity field and validation]
You: "Test fails with 'column capacity does not exist' ✗"
Claude: [Adds migration and DZQL entity registration]
You: "Test still fails, needs validation ✗"
Claude: [Adds validation logic]
You: "All tests pass! ✓"
Claude: [Commits changes]
```

## Best Practices

1. **Always run database locally** - Claude Code can't access Docker
2. **Tell Claude when tests pass/fail** - This guides the implementation
3. **Run full test suite** - Before committing, ensure all tests pass
4. **Restart database after migrations** - Ensures clean state
5. **Use watch mode** - Get instant feedback during development
6. **One feature at a time** - Focus TDD cycle on one feature
7. **Commit frequently** - After each green test

## Package-Specific Notes

### Rights Package
- Tests composite primary keys extensively
- Requires all DZQL migrations (001-008) + rights domain (009)
- Test creates fresh user for each run
- Full end-to-end workflow tested

### Venues Package
- Tests core DZQL features
- Graph rules, permissions, events
- Multiple independent test files
- Each test suite can run independently

## Quick Reference

```bash
# Start TDD session
cd packages/rights
bun db:up && bun test --watch

# Run specific test
bun test tests/basic.test.js

# Clean restart
bun db:down && bun db:up && bun test

# View database
open http://localhost:8081
```
