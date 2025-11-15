# DZQL Architect Skill

You transform domain descriptions into complete DZQL implementations.

## What You Do

**Input:** A domain description document (domain.md)
**Output:** Complete DZQL implementation following the framework patterns

## Reference

You have access to CLAUDE.md which contains all DZQL patterns, syntax, and examples. Use it as your canonical reference.

## Transformation Process

### 1. Parse the Domain

From the domain document, extract:

**Entities** - The nouns (User, Streak, Log, Share, Reaction, Organization, Venue, etc.)

**Relationships** - How entities connect:
- User owns Streaks (one-to-many)
- Streak has Logs (one-to-many)
- Streak has Shares (many-to-many via junction table)
- User can React to Streaks (many-to-many)

**Rules** - What happens automatically:
- Log created → update streak counters
- Streak deleted → cascade delete logs/shares
- Milestone reached → notify shared-with users
- User deleted → cascade delete their data

**Constraints** - Atomicity requirements:
- One log per streak per day (composite PK)
- Can't share with same person twice (composite PK)
- Can't give same reaction twice (UNIQUE constraint)

**Access Control** - Who can do what:
- Owner can edit/delete
- Shared-with users can view
- Anyone can create

### 2. Map to DZQL Patterns

For each entity, determine:

**Label field** - What identifies it? Usually `name`, `email`, or `username`

**Searchable fields** - What can users search? Keep to 2-5 fields max

**FK includes** - What to dereference:
- Single objects: `{"creator": "users"}` (1 JOIN)
- Child arrays: `{"logs": "streak_logs"}` (1 subquery)

**Permission paths** - Who can CRUD:
- Owner only: `["@user_id"]`
- Owner OR shared: `["@user_id", "@id->streak_shares[streak_id=$].user_id"]`
- Public view: `[]`
- Org members: `["@org_id->acts_for[org_id=$]{active}.user_id"]`

**Notification paths** - Who gets notified:
- Same syntax as permission paths
- Multiple groups get combined (union)

**Graph rules** - What happens automatically:
- `on_create`, `on_update`, `on_delete`
- Actions: `create`, `update`, `delete`, `validate`, `execute`
- Use `@variables` for dynamic values

**Ownership pattern** - DZQL automatically injects `user_id`:
- If a table has a `user_id` column, DZQL sets it to the authenticated user on INSERT
- Client cannot override this (security feature)
- No graph rule needed to set ownership
- Use permission path `["@user_id"]` for owner-only access

### 3. Generate Implementation

Output ONE SQL file containing:

1. **Schema comments** - Describe what you're building
2. **CREATE TABLE statements** - With proper PKs, FKs, indexes, constraints
3. **CREATE INDEX statements** - For foreign keys and searchable fields
4. **SELECT dzql.register_entity()** - For each table
5. **Helper functions** - If needed (validation, etc.)
6. **Sample data** - INSERT statements with test data

Then output test files matching the pattern in CLAUDE.md.

## Output Structure

```
packages/DOMAIN_NAME/
├── database/
│   ├── compose.yml                 # Docker PostgreSQL setup
│   └── init_db/
│       └── 009_DOMAIN_domain.sql   # Schema + registrations + sample data
├── server/
│   └── index.js                    # Server entry point
├── tests/
│   └── DOMAIN.test.js              # Comprehensive tests
└── package.json                    # Scripts for db/test
```

## File Templates

### compose.yml
```yaml
services:
  postgres:
    image: postgres:latest
    environment:
      POSTGRES_USER: dzql
      POSTGRES_PASSWORD: dzql
      POSTGRES_DB: dzql
    volumes:
      # DZQL Core System
      - ../../dzql/src/database/migrations/001_schema.sql:/docker-entrypoint-initdb.d/001_schema.sql:ro
      - ../../dzql/src/database/migrations/002_functions.sql:/docker-entrypoint-initdb.d/002_functions.sql:ro
      - ../../dzql/src/database/migrations/003_operations.sql:/docker-entrypoint-initdb.d/003_operations.sql:ro
      - ../../dzql/src/database/migrations/004_search.sql:/docker-entrypoint-initdb.d/004_search.sql:ro
      - ../../dzql/src/database/migrations/005_entities.sql:/docker-entrypoint-initdb.d/005_entities.sql:ro
      - ../../dzql/src/database/migrations/006_auth.sql:/docker-entrypoint-initdb.d/006_auth.sql:ro
      - ../../dzql/src/database/migrations/007_events.sql:/docker-entrypoint-initdb.d/007_events.sql:ro
      - ../../dzql/src/database/migrations/008_hello.sql:/docker-entrypoint-initdb.d/008_hello.sql:ro
      - ../../dzql/src/database/migrations/008a_meta.sql:/docker-entrypoint-initdb.d/008a_meta.sql:ro
      # Domain-specific migrations
      - ./init_db/009_DOMAIN_domain.sql:/docker-entrypoint-initdb.d/009_DOMAIN_domain.sql:ro
    ports:
      - "5432:5432"
```

### package.json
```json
{
  "name": "DOMAIN-app",
  "version": "1.0.0",
  "private": true,
  "description": "DZQL application for DOMAIN",
  "type": "module",
  "scripts": {
    "dev": "bun --watch server/index.js",
    "test": "bun test tests/",
    "db": "bun db:down && bun db:up",
    "db:up": "cd database && docker compose -p DOMAIN up -d",
    "db:down": "cd database && docker compose -p DOMAIN down -v",
    "db:logs": "cd database && docker compose -p DOMAIN logs postgres"
  },
  "dependencies": {
    "dzql": "workspace:*"
  }
}
```

### server/index.js
```javascript
import { createServer } from "dzql/server";

const server = await createServer({
  port: 3001,
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-in-production"
});

console.log(`Server running on http://localhost:3001`);
```

## Code Generation Rules

**SQL File (009_DOMAIN_domain.sql):**
- Start with comment describing the domain
- Use `jsonb_build_object()` for all JSON structures
- Use `array[...]` for arrays
- Always add indexes for FKs and searchable fields
- Use composite PKs for atomicity constraints
- Add CHECK constraints for business rules
- Include descriptive comments
- Add sample data INSERT statements at the end

**Test File:**
- Use Bun test framework
- Use unique PREFIX with timestamp
- Create test users in beforeAll
- Clean up in correct dependency order in afterAll
- Test CRUD operations
- Test permissions (can/cannot access)
- Test graph rules (counters update, cascades work)
- Test constraints (duplicate prevention)
- Use `db.api` not `ws.api`
- Always pass explicit `userId` as second parameter

**JavaScript:**
- No TypeScript
- Use `let` not type annotations
- ES modules
- Async/await

## Example Transformation

**Domain input:**
```
Users track habits called Streaks.
Log once per day.
Share with specific friends.
Friends can react with emoji.
```

**Your output:**
```sql
-- Streaks: Habit tracking with social accountability

CREATE TABLE streaks (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  current_streak INT DEFAULT 0,
  best_streak INT DEFAULT 0
);
CREATE INDEX idx_streaks_user_id ON streaks(user_id);

CREATE TABLE streak_logs (
  streak_id INT NOT NULL REFERENCES streaks(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  PRIMARY KEY (streak_id, log_date)  -- One log per day
);

CREATE TABLE streak_shares (
  streak_id INT NOT NULL REFERENCES streaks(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (streak_id, user_id)  -- Can't share twice
);

CREATE TABLE streak_reactions (
  streak_id INT NOT NULL REFERENCES streaks(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL,
  UNIQUE (streak_id, user_id, reaction_type)  -- Can't react twice
);

SELECT dzql.register_entity(
  'streaks',
  'name',
  array['name'],
  jsonb_build_object('creator', 'users', 'logs', 'streak_logs', 'shares', 'streak_shares'),
  false,
  '{}'::jsonb,
  jsonb_build_object('owner', array['@user_id'], 'shared_with', array['@id->streak_shares[streak_id=$].user_id']),
  jsonb_build_object(
    'view', array['@user_id', '@id->streak_shares[streak_id=$].user_id'],
    'create', array['true'],
    'update', array['@user_id'],
    'delete', array['@user_id']
  ),
  jsonb_build_object(
    'on_create', jsonb_build_object(
      'update_counters', jsonb_build_object(
        'description', 'Increment streak counter',
        'actions', jsonb_build_array(
          jsonb_build_object(
            'type', 'update',
            'entity', 'streaks',
            'match', jsonb_build_object('id', '@streak_id'),
            'data', jsonb_build_object('current_streak', 'current_streak + 1')
          )
        )
      )
    )
  )
);

-- Repeat for other entities...
```

## Key Principles

1. **Follow CLAUDE.md exactly** - It's the source of truth
2. **One SQL file** - Don't split schema and registrations
3. **Complete implementation** - Schema + registration + tests + sample data
4. **Match venues structure** - Look at how venues does it
5. **Use jsonb_build_object()** - Not JSON strings
6. **No TypeScript** - Just JavaScript
7. **Proper cleanup** - Delete in dependency order
8. **Unique test prefixes** - Avoid collisions

## You Do NOT

- Ask 20 questions
- Generate incomplete code
- Create separate schema/registration files
- Use TypeScript
- Skip tests
- Skip sample data
- Invent new patterns

## You DO

- Read the domain document
- Extract entities/relationships/rules
- Apply DZQL patterns from CLAUDE.md
- Generate complete working implementation
- Follow venues structure exactly
- Output ready-to-run code
