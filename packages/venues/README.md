# DZQL Venues Example

A venue management system demonstrating DZQL's runtime workflow with complex permissions, relationships, and real-time features.

> **Note:** This is an example application for exploring DZQL features. It uses the runtime workflow (not compiled) and demonstrates advanced patterns like graph-based permissions and metadata-driven UIs.

## What's Inside

**Domain:** Organizations, venues, sites, allocations, contractors, and packages
- **Organizations** with hierarchical relationships
- **Venues** with geolocation and branding
- **Sites** (sub-locations within venues)
- **Allocations** (space assignments)
- **Contractors** and **Packages** for marketplace features

**DZQL Features Demonstrated:**
- Complex permission paths using graph relationships (`acts_for`)
- Real-time WebSocket updates
- Foreign key expansion for nested data
- Soft deletes and temporal tracking
- Metadata endpoint for UI generation

## Quick Start

```bash
# Start the database
bun venues:db

# Run tests
bun venues:test

# View logs
bun venues:logs
```

## Database Schema

The venues domain is defined in:
- `database/init_db/009_venues_domain.sql` - Core entities
- `database/init_db/010_brands_artwork.sql` - Branding extensions

Each entity is registered with `dzql.register_entity()` using the runtime workflow.

## Current Status

This example is a work in progress exploring advanced DZQL patterns:

- ✅ Core CRUD operations working
- ✅ Permission system with `acts_for` relationships
- ✅ Real-time updates via WebSockets
- 🚧 Metadata-driven UI component generation (in development)
- 🚧 Advanced search and filtering

See [TODO.md](TODO.md) for development priorities.

## Architecture Notes

### Permission Model

Venues uses a graph-based permission model where users access resources through organizational relationships:

```sql
-- Users access venues through acts_for relationships
'view': array['@user_id->acts_for[org_id=@org_id].user_id']
```

This allows flexible multi-tenant access control where users can belong to multiple organizations with different roles.

### Metadata Endpoint

The `/meta` endpoint provides schema metadata to enable dynamic UI generation:

```javascript
const meta = await fetch('/meta').then(r => r.json());
// Returns entity definitions, permissions, relationships
```

This supports building admin interfaces that adapt to schema changes without code updates.

## Relationship to Core DZQL

This example demonstrates:
- **Runtime workflow** - Entities registered with `dzql.register_entity()` in SQL
- **No compilation** - Uses generic DZQL interpreters for CRUD operations
- **Advanced patterns** - Graph permissions, metadata endpoints, soft deletes

For a simpler example, see the [Blog](../blog/) package which demonstrates the compiled workflow.

## Testing

Tests cover:
- Authentication and authorization
- Permission enforcement across organizational boundaries  
- Real-time event broadcasting
- Search and filtering
- Domain-specific business logic

Run tests with:
```bash
bun venues:test
```

## Development Status

**Current Version:** Matches DZQL core (v0.2.1)

**Known Limitations:**
- Some advanced features are experimental
- UI generation system is under active development
- Not recommended for production use as-is

This example exists to push DZQL's capabilities and explore patterns that may be incorporated into the core framework.
