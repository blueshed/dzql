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
  permissions: { view, create, update, delete },
  includes: { rel: 'entity' },      // FK expansions
  manyToMany: { ... },
  graphRules: { on_create, on_update, on_delete },
  notifications: { ... }
}

PERMISSION DSL
==============
[]                                    = Deny all
['TRUE']                              = Public access
['@author_id']                        = @user_id == @author_id
['@author_id == @user_id']            = Explicit equality
['@org_id->acts_for[org_id=$].user_id']        = Traversal
['@org_id->acts_for[org_id=$]{active}.user_id'] = With temporal filter

SUBSCRIBABLE PATTERN
====================
sub_name: {
  params: { param: 'type' },
  root: { entity: 'table', key: 'param' },
  includes: { rel: { entity: 'table', includes: {...} } },
  scopeTables: ['all', 'affected', 'tables'],
  canSubscribe: ['permission_path']
}
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

## Subscribable Definition

Subscribables define realtime data shapes for UI components.

```typescript
export const subscribables = {
  // Name becomes: subscribe_venue_detail, get_venue_detail, useVenueDetailStore
  venue_detail: {
    params: { venue_id: 'int' },

    root: {
      entity: 'venues',
      key: 'venue_id'  // Maps param to entity PK
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
