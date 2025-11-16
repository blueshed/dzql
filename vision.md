# DZQL Vision: Compiled Database-Driven Applications

## Executive Summary

DZQL is a **compiler** that transforms declarative entity definitions into optimized PostgreSQL stored functions. No runtime interpretation. No unnecessary layers. Just PostgreSQL doing what it does best - executing compiled query plans with real-time capabilities.

## The Fundamental Problem

We've been building applications backwards. We keep adding interpretation layers on top of an already interpreted language (SQL), which itself compiles to binary execution plans. The current DZQL runs:

```
Graph Rules (JSON interpreted at runtime)
           ↓
    PL/pgSQL stored procedures (interpreted)
           ↓
      SQL (parsed/planned/optimized)
           ↓
    PostgreSQL engine (finally compiled)
```

**We're running an interpreter inside an interpreter inside a query planner.**

Each layer adds:
- Performance overhead (JSON parsing on every request)
- Debugging complexity (errors surface through multiple abstraction layers)
- Cognitive overhead (another DSL to learn)
- Optimization barriers (PostgreSQL can't see through the JSON)

## The Critical Insight

These "dynamic" configurations aren't actually dynamic. Permission rules don't change mid-request. Graph rules don't morph during transactions. They're **static code masquerading as data**.

What we're really doing:
1. Taking what should be compiled stored procedures
2. Abstracting them into JSON configurations
3. Having a generic procedure interpret those configurations
4. Every. Single. Time.

**SQL is already declarative!** We're creating a declarative DSL that generates another declarative language that then gets planned and executed. It's like writing YAML that generates JSON that generates SQL that generates execution plans.

## The Core Insight

**The configurations don't change at runtime.** Permission rules, notification paths, and relationships are essentially static code masquerading as data. They should be **compiled, not interpreted**.

## What's Actually Hard (Hint: Not CRUD)

**CRUD is trivial.** Any framework can do basic Create, Read, Update, Delete. The genuinely hard problems are:

1. **Authorization**: Who can do what, when, under what conditions, with temporal constraints?
2. **Notification**: Who needs to know when something changes, based on complex relationships?
3. **Synchronization**: How do we keep denormalized client views in sync with normalized database changes?
4. **Consistency**: How do we guarantee these rules are ALWAYS enforced atomically?

These are **graph traversal problems**, not JSON interpretation problems.

## The Solution: Compilation Over Interpretation

### From This (Current Runtime Interpretation):
```sql
-- Every request parses JSON configuration
SELECT dzql.generic_exec('save', 'venues', '{...}'::jsonb, user_id);
-- Parses permission paths, graph rules, FK includes every time
```

### To This (Compiled Functions):
```sql
-- Direct function call with logic baked in
SELECT save_venues('{...}'::jsonb, user_id);
-- Permissions, rules, and relationships pre-compiled
-- PostgreSQL optimizer can see everything
```

## Two Fundamental Patterns

### Pattern 1: Live Query (Client-Driven Subscriptions)

**"I asked for this data, keep it updated for me"**

The request becomes the subscription. The parameters become the subscription key:

```javascript
// Client makes request - automatically becomes subscription
const venue = await ws.api.get.venues({id: 1});
// Subscription key = hash("get.venues", {id: 1})

// Another client updates
await ws.api.save.venues({id: 1, name: "Updated MSG"});

// System computes affected subscriptions:
// - Anyone subscribed to get.venues({id: 1}) ✓
// - Anyone subscribed to search.venues with filters matching ✓
// - Anyone subscribed to get.organisations({id: 3}) if venue is in fk_includes ✓
```

**The Innovation**: No manual subscription management. Your query IS your subscription.

### Pattern 2: Need to Know (Data-Driven Notifications)

**"Something changed, who needs to know based on relationships?"**

Notifications flow through the data graph:
```yaml
notifications:
  on_update: "@org_id->acts_for[org_id=$]{active}.user_id"
```

This compiles to:
```sql
SELECT ARRAY_AGG(DISTINCT af.user_id)
FROM venues v
JOIN acts_for af ON af.org_id = v.org_id
WHERE v.id = updated_venue_id
  AND af.valid_to IS NULL  -- active
  AND af.role IN ('admin', 'manager')
```

**The Innovation**: Permission paths that compile to efficient SQL joins, not runtime graph traversal.

## Why Both Patterns Matter

```javascript
// Task updated in project management system

// Pattern 1 handles: View consistency
// - Update task list for users viewing this project
// - Update dashboard widgets showing this task
// - Update search results including this task

// Pattern 2 handles: Business notifications
// - Notify assignee (even if offline)
// - Alert PM if task is overdue
// - Trigger compliance workflows
// - Send webhooks to external systems
```

## The Client Synchronization Challenge

This is the genuinely hard problem DZQL solves elegantly:

```javascript
// Client has denormalized document with expanded relationships:
{
  id: 1,
  name: "Madison Square Garden",
  org: {id: 3, name: "Venue Management"},  // Expanded FK
  sites: [                                  // Included children
    {id: 1, name: "Main Level"},
    {id: 2, name: "Upper Deck"}
  ]
}

// But notifications are normalized:
{
  method: "organisations:update",
  params: {
    table: "organisations",
    op: "update",
    pk: {id: 3},
    after: {id: 3, name: "NYC Venues"}  // Just this table
  }
}

// THE HARD PROBLEM: How do you update all client documents
// that have this org expanded without re-fetching everything?
```

Traditional approaches fail:
- **Re-fetch everything** - Wasteful, destroys local state
- **Only update changed record** - Loses relationship updates
- **Manual update paths** - Error-prone, exponential complexity

DZQL's approach:
- **Declare relationships once** (fk_includes)
- **Automatically expand on fetch** (denormalized reads)
- **Broadcast minimal changes** (normalized updates)
- **Client surgically updates** nested objects in denormalized views

This is the **view maintenance problem** - keeping materialized views (client documents) in sync with normalized source data. It's unsolved in GraphQL, REST, and most real-time systems.

## The Compiler Architecture

### Input: Declarative Entity Definition
```yaml
entity: venues
table: venues

permissions:
  view: "public"
  update: "@org_id->acts_for[org_id=$,role='admin']{active}.user_id"
  delete: "@owner_id"

notifications:
  on_update: "@org_id->acts_for[org_id=$]{active}.user_id"

fk_includes:
  org: organisations
  sites: sites

graph_rules:
  on_create:
    establish_ownership:
      - {type: create, entity: ownership, data: {resource: '@id', user_id: '@user_id'}}
```

### Output: Native PostgreSQL Functions

The compiler generates multiple functions per entity:

```sql
-- 1. Permission Check (no JSON parsing)
CREATE OR REPLACE FUNCTION can_update_venues(p_user_id INT, p_venue_id INT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM venues v
    JOIN acts_for af ON af.org_id = v.org_id
    WHERE v.id = p_venue_id
      AND af.user_id = p_user_id
      AND af.valid_to IS NULL
      AND af.role = 'admin'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- 2. Save Operation (everything compiled in)
CREATE OR REPLACE FUNCTION save_venues(p_data jsonb, p_user_id int)
RETURNS jsonb AS $$
DECLARE
  v_result venues;
  v_notify_users int[];
BEGIN
  -- Direct permission check, no JSON interpretation
  IF p_data->>'id' IS NOT NULL AND
     NOT can_update_venues(p_user_id, (p_data->>'id')::int) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Standard UPSERT
  INSERT INTO venues (columns...) VALUES (values...)
  ON CONFLICT (id) DO UPDATE SET ...
  RETURNING * INTO v_result;

  -- Graph rules compiled as direct SQL
  IF TG_OP = 'INSERT' THEN
    INSERT INTO ownership (resource, user_id)
    VALUES ('venues:' || v_result.id, p_user_id);
  END IF;

  -- Notification paths compiled to joins
  SELECT ARRAY_AGG(DISTINCT af.user_id)
  FROM acts_for af
  WHERE af.org_id = v_result.org_id
    AND af.valid_to IS NULL
  INTO v_notify_users;

  -- Return with FK expansions (predetermined)
  RETURN jsonb_build_object(
    'id', v_result.id,
    'name', v_result.name,
    'org', (SELECT row_to_json(o) FROM organisations o WHERE o.id = v_result.org_id),
    'sites', (SELECT jsonb_agg(s) FROM sites s WHERE s.venue_id = v_result.id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Subscription Matcher (knows all relationships at compile time)
CREATE OR REPLACE FUNCTION venues_affects_subscription(
  p_method text, p_params jsonb, p_old jsonb, p_new jsonb
) RETURNS boolean AS $$
BEGIN
  CASE p_method
    WHEN 'get.venues' THEN
      -- Simple ID match
      RETURN (p_params->>'id')::int = (p_new->>'id')::int;

    WHEN 'search.venues' THEN
      -- Did it enter or exit search results?
      RETURN (
        -- Was not in results, now is
        (p_old IS NULL OR NOT venue_matches_filters(p_old, p_params->'filters'))
        AND venue_matches_filters(p_new, p_params->'filters')
      ) OR (
        -- Was in results, now isn't
        (p_old IS NOT NULL AND venue_matches_filters(p_old, p_params->'filters'))
        AND NOT venue_matches_filters(p_new, p_params->'filters')
      );

    WHEN 'get.organisations' THEN
      -- Organization includes venues in FK expansion
      RETURN (p_params->>'id')::int = (p_new->>'org_id')::int;

    ELSE
      RETURN false;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

**The key**: Every piece of logic is compiled to native PostgreSQL. No JSON is parsed at runtime.

## Key Benefits

### 1. Performance
- No JSON parsing at runtime
- PostgreSQL optimizer sees actual queries
- Indexes properly utilized
- Predictable query plans

### 2. Debuggability
- Real stack traces in PostgreSQL
- EXPLAIN ANALYZE works normally
- Can add targeted logging
- Source maps link SQL to entity definitions

### 3. Reproducibility
```bash
# Same input ALWAYS produces same output
$ dzql compile entities/venues.yaml
Generated: venues_v1.sql (sha256:abcd1234...)

# Months later, same hash
$ dzql compile entities/venues.yaml
Generated: venues_v1.sql (sha256:abcd1234...) [unchanged]
```

### 4. Testability
```sql
-- Generated test functions
SELECT test_venues_permissions();  -- Verify permission logic
SELECT test_venues_notifications(); -- Verify notification paths
SELECT test_venues_subscriptions(); -- Verify live query matching
```

## Scaling to 50+ Entities

### Consistent Structure
```
project/
├── entities/           # Declarative definitions
│   ├── core/          # Users, orgs, permissions
│   ├── venues/        # Venues domain
│   └── rights/        # Rights management
├── compiled/          # Generated SQL (git-tracked!)
│   └── checksums.json # Ensures reproducibility
└── tests/             # Automated verification
```

### Domain Patterns
Instead of reimplementing common patterns, inherit them:
```yaml
entity: project_tasks
extends: [org_scoped, temporal, collaborative]
overrides:
  permissions:
    update: "@assignee_id + {super}"
```

## Learning from Failed Abstractions

This pattern of "abstraction layers that seem like good ideas" has failed before:
- **ORMs** that generate terrible SQL
- **GraphQL resolvers** that create N+1 query problems
- **Redux boilerplate** that's longer than the jQuery it replaced

They all share the same mistake: **adding interpretation layers instead of compilation**.

The road to complexity hell is paved with runtime abstractions that could have been compile-time transformations.

## Why PostgreSQL-Native

Instead of lowest-common-denominator SQL, we embrace PostgreSQL as a platform:

- **NOTIFY/LISTEN**: Native real-time without external queues
- **JSONB**: Powerful JSON operations with indexing
- **Arrays**: Critical for permission lists and batch operations
- **MVCC**: Predictable transaction isolation
- **CTEs**: Complex queries remain readable
- **Extensions**: PostGIS, temporal, vectors when needed

**Decision**: Make DZQL the best PostgreSQL-native framework possible, rather than a mediocre portable one.

## What Makes This Different

### Traditional ORMs/Query Builders
Add abstraction layers that generate SQL dynamically, often producing inefficient queries.

### GraphQL/REST Frameworks
Solve API design but ignore permissions, notifications, and real-time as afterthoughts.

### Firebase/Supabase
Real-time first but limited query capabilities and vendor lock-in to their platform.

### DZQL
- **Compiles** to native PostgreSQL (no runtime overhead)
- **Two patterns** that solve different problems (Live Query + Need to Know)
- **Permissions and notifications** are first-class concepts
- **Database as source of truth** with atomic operations
- **Your PostgreSQL**, not a platform vendor lock-in

## The Philosophy

1. **Compile, don't interpret** - Static analysis and optimization at build time
2. **Two patterns for two problems** - Live queries for views, Need to Know for business logic
3. **PostgreSQL as platform** - Embrace its power instead of abstracting it away
4. **Correctness over scale** - Better to be right for 1000 users than wrong for millions
5. **AI-friendly** - Declarative patterns that AI can reason about and generate

## Success Metrics

A successful DZQL implementation:
- **Zero runtime interpretation** - Everything is compiled PostgreSQL functions
- **Predictable performance** - EXPLAIN shows exactly what runs
- **Comprehensive tests** - Every permission path and notification rule tested
- **Reproducible builds** - Same input always generates same SQL
- **Developer joy** - Focus on business logic, not plumbing

## The Endgame

Developers write:
```yaml
entity: invoice
permissions:
  create: "@company.billing_admins"
  approve: "@amount < 1000 ? @company.managers : @company.directors"
notifications:
  on_approve: "@creator + @company.accounting_team"
```

DZQL compiles to efficient PostgreSQL that handles:
- Authorization checks
- Atomic operations with side effects
- Real-time updates to affected clients
- Smart notifications to right people
- Complete audit trail

**No runtime interpretation. No unnecessary layers. Just compiled PostgreSQL doing what it does best.**

## The Uncomfortable Truth

Every popular web framework today is solving the wrong problem. They're making it easier to write boilerplate instead of eliminating it. They're adding abstraction layers instead of removing them. They're interpreting at runtime what should be compiled at build time.

DZQL represents a fundamentally different approach:
- **Move complexity to compile time** where it can be analyzed and optimized
- **Trust the database** to be the application engine it was designed to be
- **Embrace constraints** - PostgreSQL-only is a feature, not a limitation
- **Solve the hard problems** - Permissions and notifications, not CRUD

## What This Enables

With 50+ entities in your system:

```bash
# Monday: Define new entity
$ cat > entities/invoices.yaml
entity: invoices
permissions:
  approve: "@amount < 1000 ? @department.managers : @finance.all"
notifications:
  on_approve: "@creator + @department.accounting"

# Compile it
$ dzql compile entities/invoices.yaml
Generated: compiled/invoices_v1.sql

# Test it
$ dzql test invoices
✓ Permission: managers can approve under $1000
✓ Permission: only finance can approve over $1000
✓ Notification: creator notified on approval
✓ Notification: accounting notified on approval

# Deploy it
$ psql < compiled/invoices_v1.sql

# Use it (no server code changes!)
await ws.api.save.invoices({...})
await ws.api.approve.invoices({id: 1})
```

**Zero application code written. Full permissions, notifications, real-time updates.**

## Next Steps

1. **Design the permission path DSL** - Expressive yet compilable
2. **Build the parser** - YAML/DSL → AST
3. **Create the code generator** - AST → Optimized PostgreSQL
4. **Add optimization passes** - Combine similar queries, inline simple checks
5. **Implement source maps** - Link generated SQL to entity definitions
6. **Build test framework** - Verify all paths and rules

## The Bottom Line

Stop building interpreters on top of interpreters. Stop adding layers of abstraction that provide no real value. Stop treating the database as dumb storage.

**Compile your business logic to where it belongs: the database.**

The future isn't more abstraction layers. The future is compilation.