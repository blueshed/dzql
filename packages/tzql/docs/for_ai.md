# DZQL Domain Modeling Guide

This guide defines patterns for generating valid DZQL domain definitions.

## Quick Reference

```
DOMAIN STRUCTURE
================
export default {
  entities: { ... },
  subscribables: { ... },
  customFunctions: [ ... ],
  auth: { ... }              // Optional: override auth types
} satisfies DomainConfig;

ENTITY PATTERN
==============
entity_name: {
  schema: { column: 'pg_type constraints' },
  primaryKey: ['id'],        // Default, override for composite
  label: 'name',             // For lookups/display
  searchable: ['name'],      // Text search fields
  hidden: ['password_hash'], // Exclude from API responses
  managed: true,             // false = skip CRUD generation
  softDelete: false,         // true = use deleted_at
  temporal: { ... },         // For versioned entities with validity periods
  permissions: { view, create, update, delete },
  includes: { rel: 'entity' },      // FK expansions
  manyToMany: { ... },
  graphRules: { on_create, on_update, on_delete },
  notifications: { ... }
}

TEMPORAL ENTITY PATTERN
=======================
temporal: {
  refField: 'ref',           // Stable identifier across versions
  validFrom: 'valid_from',   // Period start column
  validTo: 'valid_to',       // Period end column (NULL = current)
  sequence: 'table_ref_seq'  // Optional: custom sequence name
}
// Generates: save (creates new version), get (by ref/id/as_of), history, search (current only)

PERMISSION DSL
==============
[]                                    = Deny all
['TRUE']                              = Public access
['@author_id']                        = @user_id == @author_id
['@author_id == @user_id']            = Explicit equality
['@org_id->acts_for[org_id=$].user_id']        = Single-hop traversal
['@org_id->acts_for[org_id=$]{active}.user_id'] = With condition filter

CONDITION FILTERS
=================
{active}                    = Boolean: active = true
{role=admin}                = Equality: role = 'admin'
{valid_to=NULL}             = NULL check: valid_to IS NULL
{active,role=owner}         = Multiple: active = true AND role = 'owner'

TRAVERSAL DEPTH (Unlimited)
===========================
Single:  @org_id->acts_for[org_id=$]{active}.user_id
2-hop:   @venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id
3-hop:   @site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id
N-hop:   @pkg_id->packages.occasion_id->occasions.venue_id->venues.org_id->user_orgs[org_id=$].user_id

TABLE-FIRST PATTERN
===================
rights[package_id=@package_id]{active}.org_id->user_orgs[org_id=$].user_id
// When traversal starts from a lookup table, not a field on the current entity

SUBSCRIBABLE PATTERN
====================
sub_name: {
  params: { param: 'type' },
  root: { entity: 'table', key: 'param' },  // key must be in params, or '@user_id', or empty for lists
  includes: { rel: { entity: 'table', includes: {...} } },
  scopeTables: ['all', 'affected', 'tables'],
  canSubscribe: ['permission_path']
}

ROOT KEY RULES:
- key: 'venue_id' -> must have params: { venue_id: 'int' } -> returns single entity
- key: '@user_id' -> uses current user, no param needed -> returns single entity
- key: '' or omit -> list subscribable -> returns array of entities

SUBSCRIBABLE TYPES:
1. Single Entity: has root.key, returns one document with includes
2. List Subscribable: no root.key, returns array of documents
```

## Entity Definition

Each key in `entities` maps to a PostgreSQL table.

```typescript
export const entities = {
  posts: {
    schema: {
      id: 'serial PRIMARY KEY',
      title: 'text NOT NULL',
      content: 'text',
      author_id: 'int NOT NULL REFERENCES users(id)',
      org_id: 'int REFERENCES organisations(id) ON DELETE CASCADE',
      created_at: 'timestamptz DEFAULT now()',
      deleted_at: 'timestamptz'  // For soft delete
    },

    label: 'title',
    searchable: ['title', 'content'],
    softDelete: true,

    permissions: {
      view: ['@org_id->acts_for[org_id=$]{active}.user_id'],
      create: ['@org_id->acts_for[org_id=$]{active}.user_id'],
      update: ['@author_id'],
      delete: ['@author_id']
    },

    // FK expansions - automatically included in responses
    includes: {
      author: 'users',
      org: 'organisations'
    },

    graphRules: {
      on_create: {
        notify_org: {
          actions: [
            { type: 'reactor', name: 'send_notification', params: { org_id: '@org_id' } }
          ]
        }
      }
    },

    notifications: {
      org_members: ['@org_id->acts_for[org_id=$]{active}.user_id']
    }
  }
};
```

## Permission Patterns

Permissions compile to SQL `EXISTS` clauses. Rules are OR'd together.

### Variables
- `@user_id` - Authenticated user's ID
- `@field` - Value of field in the record
- `@id` - Record's primary key value

### Common Patterns

```typescript
// Owner only
update: ['@author_id']  // Shorthand for @author_id == @user_id

// Organization member via junction table
view: ['@org_id->acts_for[org_id=$]{active}.user_id']
// Reads as: "user exists in acts_for where org_id matches and active=true"

// Self (user can only access own record)
view: ['@id']  // For users table: @id == @user_id

// Public read, authenticated write
view: ['TRUE'],
create: []  // Empty = logged-in users only

// Multiple paths (OR'd)
view: ['@author_id', '@org_id->acts_for[org_id=$].user_id']
```

### Traversal Syntax

```
@field->table[join_condition]{filter}.target_field
  │      │          │           │          │
  │      │          │           │          └── Final check: table.target_field = @user_id
  │      │          │           └── Optional: WHERE filter (e.g., active=true, temporal)
  │      │          └── Join: table.join_field = current.@field
  │      └── Target table
  └── Starting field on current entity
```

## CRUD Operations

Every entity gets 5 operations: `get`, `save`, `delete`, `search`, `lookup`.

### Get - Rich Document

`get` returns a **rich document** with FK and M2M expansions:

```typescript
// Entity with includes and manyToMany
posts: {
  schema: { id: 'serial PRIMARY KEY', author_id: 'int', org_id: 'int', title: 'text' },
  includes: { author: 'users', org: 'organisations' },
  manyToMany: { tags: { junctionTable: 'post_tags', ... } }
}

// get_posts({ id: 1 }) returns:
{
  id: 1,
  author_id: 5,
  org_id: 2,
  title: 'Hello',
  author: { id: 5, name: 'Alice', email: '...' },  // Direct FK expanded
  org: { id: 2, name: 'Acme Corp' },               // Direct FK expanded
  tag_ids: [1, 3, 7],                               // M2M IDs
  tags: [{ id: 1, name: 'tech' }, ...]             // M2M expanded (if expand: true)
}
```

**Key insight:** `get` is already a rich document. Use it as the starting point. Only move to subscribables when you need:
- One-to-many (reverse FK) expansion
- Complex nested includes
- Realtime updates across multiple tables

### Save - Atomic with Side Effects

`save` handles insert/update, M2M sync, and graph rules in one transaction:

```typescript
// Insert (no id)
await ws.api.save_posts({ title: 'New', author_id: 1, tag_ids: [1, 2] });

// Update (has id) - partial update, only provided fields change
await ws.api.save_posts({ id: 1, title: 'Updated' });

// M2M sync happens automatically
await ws.api.save_posts({ id: 1, tag_ids: [3, 4] });  // Replaces old tags
```

Returns the full document with FK/M2M expansions.

### Search - Filtered List

```typescript
await ws.api.search_posts({
  filters: { org_id: { eq: 1 }, title: { ilike: '%hello%' } },
  sort_field: 'created_at',
  sort_order: 'desc',
  limit: 20,
  offset: 0
});
```

Filter operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, `ilike`, `is_null`.

### Lookup - Autocomplete

```typescript
await ws.api.lookup_posts({ q: 'hel' });  // Returns [{label: 'Hello World', value: 1}, ...]
```

Uses the entity's `label` field for display.

### Delete

```typescript
await ws.api.delete_posts({ id: 1 });  // Hard delete or soft delete based on entity config
```

## Subscribable Definition

Subscribables define realtime data shapes for UI components.

### Single Entity Subscribable

Returns one document with nested includes:

```typescript
export const subscribables = {
  // Name becomes: subscribe_venue_detail, get_venue_detail, useVenueDetailStore
  venue_detail: {
    params: { venue_id: 'int' },

    root: {
      entity: 'venues',
      key: 'venue_id'  // Must match a param name
    },

    includes: {
      org: 'organisations',  // Simple: FK expansion
      sites: {
        entity: 'sites',
        includes: {
          allocations: 'allocations'  // Nested
        }
      }
    },

    // ALL tables that can trigger updates
    scopeTables: ['venues', 'organisations', 'sites', 'allocations'],

    // Who can subscribe
    canSubscribe: ['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id']
  }
};
```

### List Subscribable

Returns an array of entities. Omit `root.key` to create a list:

```typescript
export const subscribables = {
  // Returns all venues the user can access
  my_venues: {
    params: {},  // No params needed

    root: {
      entity: 'venues'
      // NO KEY - this makes it a list subscribable
    },

    includes: {
      org: 'organisations'  // Each venue gets its org expanded
    },

    scopeTables: ['venues', 'organisations'],

    // Empty = authenticated users only
    // Row-level filtering happens in the query based on user context
    canSubscribe: []
  }
};
```

### Generated Types

The compiler generates TypeScript types for subscribables:

```typescript
// Generated in client/ws.ts
export interface VenueDetailParams {
  venue_id: number;
}

export interface VenueDetailResult extends Venues {
  org?: Organisations;      // Many-to-one (singular)
  sites?: Sites[];          // One-to-many (array)
}

// In DzqlAPI interface
subscribe_venue_detail: (
  params: VenueDetailParams,
  callback: (data: VenueDetailResult) => void
) => Promise<{ data: VenueDetailResult; unsubscribe: () => Promise<void> }>;
```

## Many-to-Many Relationships

```typescript
brands: {
  schema: {
    id: 'serial PRIMARY KEY',
    name: 'text NOT NULL'
  },
  manyToMany: {
    tags: {
      junctionTable: 'brand_tags',
      localKey: 'brand_id',
      foreignKey: 'tag_id',
      targetEntity: 'tags',
      idField: 'tag_ids'  // Param name for save: { tag_ids: [1,2,3] }
    }
  }
},

// Junction table - skip CRUD generation
brand_tags: {
  schema: {
    brand_id: 'int NOT NULL REFERENCES brands(id) ON DELETE CASCADE',
    tag_id: 'int NOT NULL REFERENCES tags(id) ON DELETE CASCADE'
  },
  primaryKey: ['brand_id', 'tag_id'],
  managed: false  // No get_brand_tags, save_brand_tags, etc.
}
```

## Graph Rules (Side Effects)

```typescript
graphRules: {
  on_create: {
    rule_name: {
      description: 'Create audit log on insert',
      actions: [
        // Create related record
        {
          type: 'create',
          entity: 'audit_logs',
          data: { entity: 'posts', entity_id: '@id', action: 'created' }
        },
        // Call external service via runtime
        {
          type: 'reactor',
          name: 'send_email',
          params: { user_id: '@author_id', template: 'post_created' }
        }
      ]
    }
  },

  on_update: {
    status_change: {
      condition: "@before.status = 'draft' AND @after.status = 'published'",
      actions: [
        { type: 'reactor', name: 'notify_subscribers', params: { post_id: '@id' } }
      ]
    }
  },

  on_delete: {
    cleanup: {
      actions: [
        { type: 'delete', target: 'comments', match: { post_id: '@id' } }
      ]
    }
  }
}
```

## Custom Functions

### SQL Functions

```typescript
export const customFunctions = [
  {
    name: 'calculate_stats',
    sql: `
CREATE OR REPLACE FUNCTION dzql_v2.calculate_stats(p_user_id int, p_params jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM posts WHERE org_id = (p_params->>'org_id')::int)
  );
END;
$$;`,
    args: ['p_user_id', 'p_params'],
    // Type information for generated client
    params: { org_id: 'number' },
    returns: { total: 'number' }
  }
];
```

### JavaScript Functions

Register in server startup for external APIs, complex logic, or env access:

```typescript
import { registerJsFunction } from 'dzql';

registerJsFunction('send_email', async (ctx) => {
  const { userId, params, db } = ctx;
  await fetch('https://api.sendgrid.com/...', { ... });
  return { sent: true };
});
```

## Auth Configuration

Override default auth types for client generation:

```typescript
export default {
  entities: { ... },
  
  auth: {
    userFields: {
      user_id: 'number',
      email: 'string',
      name: 'string',
      avatar_url: 'string'
    },
    loginParams: { email: 'string', password: 'string' },
    registerParams: { email: 'string', password: 'string', name: 'string' }
  }
} satisfies DomainConfig;
```

Generated types:
```typescript
interface LoginParams { email: string; password: string; }
interface LoginResult extends AuthUser { token: string; }
interface RegisterParams { email: string; password: string; name: string; }
interface RegisterResult extends AuthUser { token: string; }
```

## Client Usage

### WebSocket Connection

```typescript
import { ws } from '@generated/client';

await ws.connect('/ws');

// Typed API
const user = await ws.api.login_user({ email: '...', password: '...' });
const post = await ws.api.save_posts({ title: 'Hello', org_id: 1 });
const posts = await ws.api.search_posts({ filters: { org_id: { eq: 1 } } });
```

### Subscribable Stores

```typescript
import { useVenueDetailStore } from '@generated/client/stores';

const store = useVenueDetailStore();
const { data } = await store.bind({ venue_id: 1 });

// data is reactive - updates automatically on changes
console.log(data.name, data.org.name, data.sites.length);
```

## Common Modeling Patterns

### Multi-tenant with Organizations

```typescript
entities: {
  users: { schema: { id: 'serial PRIMARY KEY', email: 'text UNIQUE NOT NULL' } },
  organisations: { schema: { id: 'serial PRIMARY KEY', name: 'text NOT NULL' } },
  acts_for: {
    schema: {
      user_id: 'int REFERENCES users(id)',
      org_id: 'int REFERENCES organisations(id)',
      valid_from: 'date DEFAULT CURRENT_DATE',
      valid_to: 'date',
      active: 'boolean GENERATED ALWAYS AS (valid_to IS NULL OR valid_to > CURRENT_DATE) STORED'
    },
    primaryKey: ['user_id', 'org_id', 'valid_from']
  },
  // All tenant data uses org_id and permission path
  posts: {
    schema: { ..., org_id: 'int REFERENCES organisations(id)' },
    permissions: {
      view: ['@org_id->acts_for[org_id=$]{active}.user_id']
    }
  }
}
```

### Ownership Pattern

```typescript
posts: {
  schema: { ..., author_id: 'int REFERENCES users(id)' },
  fieldDefaults: { author_id: '@user_id' },  // Auto-set on create
  permissions: {
    view: ['TRUE'],
    create: [],
    update: ['@author_id'],
    delete: ['@author_id']
  }
}
```

### Soft Delete

```typescript
posts: {
  schema: { ..., deleted_at: 'timestamptz' },
  softDelete: true
  // delete_posts sets deleted_at instead of removing row
  // search_posts excludes deleted_at IS NOT NULL by default
}
```

### Temporal Entities (Versioned Records)

For entities that need full history with point-in-time queries:

```typescript
documents: {
  schema: {
    id: 'serial PRIMARY KEY',           // Version PK (auto-increment)
    ref: 'int NOT NULL',                // Stable identifier across versions
    title: 'text NOT NULL',
    content: 'text',
    author_id: 'int REFERENCES users(id)',
    valid_from: 'timestamptz NOT NULL DEFAULT now()',
    valid_to: 'timestamptz'             // NULL = current version
  },

  temporal: {
    refField: 'ref',         // Stable identifier field
    validFrom: 'valid_from', // Period start
    validTo: 'valid_to'      // Period end (NULL = current)
    // sequence: 'documents_ref_seq'  // Optional: custom sequence
  },

  permissions: {
    view: ['TRUE'],
    create: ['@author_id'],
    update: ['@author_id'],
    delete: ['@author_id']
  }
}
```

**Generated Operations:**

```typescript
// INSERT - creates first version, assigns ref from sequence
await ws.api.save_documents({ title: 'Draft', content: '...' });
// Returns: { id: 1, ref: 1, title: 'Draft', valid_from: '2024-...', valid_to: null }

// UPDATE - closes current version, inserts new version with same ref
await ws.api.save_documents({ ref: 1, title: 'Final', content: '...' });
// Old version: valid_to set to now()
// New version: { id: 2, ref: 1, title: 'Final', valid_from: now(), valid_to: null }

// GET by ref - returns current version (valid_to IS NULL)
await ws.api.get_documents({ ref: 1 });

// GET by id - returns specific version
await ws.api.get_documents({ id: 1 });

// GET at point-in-time
await ws.api.get_documents({ ref: 1, as_of: '2024-01-15T00:00:00Z' });

// SEARCH - only returns current versions (valid_to IS NULL)
await ws.api.search_documents({ filters: { author_id: { eq: 5 } } });

// HISTORY - returns all versions for a ref, ordered by valid_from
await ws.api.history_documents({ ref: 1 });

// DELETE - closes current version (sets valid_to), no hard delete
await ws.api.delete_documents({ ref: 1 });
```

**Use Cases:**
- Audit trails with full change history
- Legal documents requiring point-in-time retrieval
- Configuration versioning
- Content management with drafts and published versions

## CLI Tools

### Compile Domain

```bash
bunx dzql domain.ts                    # Output to ./dist
bunx dzql domain.ts -o ./generated     # Custom output directory
bunx dzql compile domain.ts            # Explicit compile command
```

### Validate Paths

Validate all permission and notification paths without running the full compiler:

```bash
bunx dzql validate-paths domain.ts
```

Output:
```
✓ posts.permissions.view[0]: valid
✓ posts.permissions.update[0]: valid
✗ posts.notifications[0]: unknown table 'acts_forr'
✓ venue_detail.permissions.view[0]: valid

52 paths validated, 1 error
```

**Use Cases:**
- Pre-commit validation of path syntax
- CI/CD pipeline checks
- Debugging permission compilation issues
