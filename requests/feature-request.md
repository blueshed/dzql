# Feature Request: Multi-Tenant Schema Support for dzql

## Summary

Enable multiple dzql applications to co-locate in a single PostgreSQL database by using PostgreSQL schemas for tenant isolation.

## Current Behaviour

- dzql core tables live in `dzql` schema (`dzql.entities`, `dzql.events`, `dzql.subscribables`)
- Application tables live in `public` schema
- Single NOTIFY channel (`dzql`) for all real-time events
- No built-in support for multiple applications sharing a database

## Proposed Behaviour

Each application gets its own schema, allowing multiple dzql apps to share a single PostgreSQL instance:

```
database: shared_db
├── dzql/                    # Core framework (shared)
│   ├── entities
│   ├── events  
│   └── subscribables
├── app1/                    # Application 1
│   ├── projects
│   ├── tasks
│   └── teams
├── app2/                    # Application 2
│   ├── venues
│   ├── sites
│   └── events
└── public/                  # Shared utilities (optional)
```

## Use Cases

1. **Development** - Run multiple projects locally without separate Postgres containers
2. **Multi-tenant SaaS** - Each tenant gets their own schema
3. **Microservices** - Multiple services share one database with isolation
4. **Cost reduction** - Fewer database instances to manage

## Technical Considerations

### 1. Schema-Qualified Entity Registration

```sql
-- Current
SELECT dzql.register_entity('projects', ...);

-- Proposed
SELECT dzql.register_entity('app1.projects', ...);
-- OR
SET search_path TO app1, dzql, public;
SELECT dzql.register_entity('projects', ...);
```

### 2. Core Tables Location

**Option A: Shared dzql schema (recommended)**
- Single `dzql.entities` table with `schema_name` column
- Single `dzql.events` table, partitioned or filtered by schema
- Simpler upgrades, single source of truth

**Option B: Per-app dzql tables**
- Each app gets `app1_dzql.entities`, `app2_dzql.entities`
- Complete isolation but more complex upgrades
- Duplicated framework code

### 3. NOTIFY Channel Strategy

**Option A: Single channel with schema prefix**
```sql
-- Current
NOTIFY dzql, '{"table": "projects", ...}'

-- Proposed  
NOTIFY dzql, '{"schema": "app1", "table": "projects", ...}'
```
Server filters by schema before broadcasting.

**Option B: Per-schema channels**
```sql
NOTIFY dzql_app1, '{"table": "projects", ...}'
NOTIFY dzql_app2, '{"table": "venues", ...}'
```
Each app LISTENs to its own channel.

### 4. Connection Configuration

```javascript
// Server configuration
const db = createDb({
  connectionString: process.env.DATABASE_URL,
  schema: 'app1'  // NEW: default schema for this app
});

// Sets search_path on connect
// SET search_path TO app1, dzql, public;
```

### 5. Events Table Considerations

The `dzql.events` table could grow large with multiple apps:

```sql
-- Option A: Single table with schema column
CREATE TABLE dzql.events (
  event_id BIGSERIAL PRIMARY KEY,
  schema_name TEXT NOT NULL DEFAULT 'public',  -- NEW
  table_name TEXT NOT NULL,
  ...
);

-- Option B: Partitioned by schema
CREATE TABLE dzql.events (...) PARTITION BY LIST (schema_name);
CREATE TABLE dzql.events_app1 PARTITION OF dzql.events FOR VALUES IN ('app1');
CREATE TABLE dzql.events_app2 PARTITION OF dzql.events FOR VALUES IN ('app2');
```

### 6. Migration Path

1. Add optional `schema` parameter to `register_entity()`
2. Update `generic_exec()` to respect schema
3. Add `schema` field to NOTIFY payload
4. Update server to filter events by configured schema
5. Update client subscription handling

## API Changes

### Server

```javascript
import { createServer } from 'dzql/server';

const server = createServer({
  port: 3000,
  database: process.env.DATABASE_URL,
  schema: 'myapp',  // NEW
  jwt: { secret: process.env.JWT_SECRET }
});
```

### Entity Registration

```sql
-- Explicit schema
SELECT dzql.register_entity(
  'myapp.projects',  -- schema.table format
  'name',
  ...
);

-- Or rely on search_path
SET search_path TO myapp, dzql, public;
SELECT dzql.register_entity('projects', ...);
```

### CLI

```bash
# Compile with schema
dzql compile entities.sql -o compiled/ --schema myapp

# Init specific schema
dzql db:init --schema myapp
```

## Compatibility

- **Backward compatible**: Default behaviour unchanged when no schema specified
- **Opt-in**: Apps explicitly enable multi-schema mode
- **Gradual migration**: Existing apps can migrate one entity at a time

## Questions to Resolve

1. Should `dzql.events` be shared or per-schema?
2. Should subscriptions be schema-aware or require explicit schema in params?
3. How to handle cross-schema references (if at all)?
4. Should the NOTIFY channel be shared or per-schema?

## Priority

Medium - useful for development and production cost savings, but not blocking current work.

## Related

- PostgreSQL schemas documentation: https://www.postgresql.org/docs/current/ddl-schemas.html
- Row-level security as alternative: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
