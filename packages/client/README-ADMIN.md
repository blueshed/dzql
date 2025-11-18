# DZQL Admin - Zero Configuration Admin Interface

**A metadata-driven admin interface that requires ZERO configuration.**

## Philosophy

Unlike traditional admin frameworks that require extensive configuration, DZQL Admin generates a complete CRUD interface automatically from your database metadata.

**You provide:** A WebSocket connection
**DZQL provides:** Everything else

## Quick Start

```bash
npm install dzql
```

```html
<!DOCTYPE html>
<html>
<body>
  <div id="app"></div>

  <script type="module">
    import { createDZQLAdmin } from 'dzql/admin'

    const admin = createDZQLAdmin('ws://localhost:3000/ws')
    admin.mount('#app')
  </script>
</body>
</html>
```

**That's it!** You now have a full-featured admin interface with:

- ✅ Automatic CRUD for all database tables
- ✅ Smart forms generated from schema
- ✅ Foreign key lookups with autocomplete
- ✅ Search, sort, pagination
- ✅ Permission-aware UI
- ✅ Real-time updates via WebSocket
- ✅ Data export (CSV/JSON)
- ✅ Mobile-responsive design
- ✅ Validation based on schema constraints
- ✅ Relationship navigation

## How It Works

### 1. Connect
DZQL Admin connects to your DZQL WebSocket endpoint.

### 2. Discover
It automatically fetches metadata about:
- All registered entities
- Column types and constraints
- Foreign key relationships
- Permissions
- Searchable fields
- Label fields

### 3. Generate
From this metadata alone, it generates:
- **List views** - Tables with search, sort, pagination
- **Detail views** - Forms for viewing/editing records
- **Create views** - Forms for new records
- **Navigation** - Entity browser and relationship links

### 4. Adapt
The UI adapts in real-time to:
- Schema changes
- Permission changes
- Data updates (via WebSocket broadcasts)

## Zero Config vs Optional Config

### Zero Config (Recommended)
```js
// This is all you need!
createDZQLAdmin('ws://localhost:3000/ws').mount('#app')
```

DZQL figures out:
- Which columns to show in lists
- What input types to use in forms
- How to display relationships
- What operations are allowed
- How to validate data

### Optional Config (For Customization)
```js
createDZQLAdmin('ws://localhost:3000/ws', {
  title: 'My Admin',
  theme: 'dark',

  entities: {
    // Only configure entities you want to customize
    venues: {
      icon: 'building',
      list: {
        columns: ['name', 'city', 'capacity'],
        defaultSort: 'name'
      }
    }
    // Other entities use auto-generated UI
  }
}).mount('#app')
```

**Key principle:** Config is for **overriding**, not **defining**. Everything works without it.

## What Makes This Different?

### Traditional Admin Frameworks
```python
# Django Admin - Manual registration
@admin.register(Venue)
class VenueAdmin(admin.ModelAdmin):
    list_display = ['name', 'city', 'capacity']
    search_fields = ['name', 'city']
    list_filter = ['city']
    # ... 50 more lines of config
```

### DZQL Admin
```js
// Nothing. It just works.
createDZQLAdmin(ws).mount('#app')
```

## AI-Enhanced Development

Because the entire UI is generated from declarative metadata, AI can:

1. **Maintain complex interpreters** that would be brittle for humans
2. **Evolve the system** as requirements change
3. **Generate optimizations** automatically
4. **Validate configurations** in real-time
5. **Create custom generators** for specific use cases

This is **post-manual-configuration** admin development.

## Architecture

```
DZQL Server (Postgres)
    ↓ (WebSocket)
Metadata + Operations
    ↓
DZQL Admin (Vue)
    ↓
Generated UI Components
    ↓
User's Browser
```

**No build step.** **No configuration files.** **No boilerplate.**

Just: Database → Metadata → UI

## What DZQL Provides

DZQL's metadata system gives us everything we need:

```json
{
  "entities": {
    "venues": {
      "table_name": "venues",
      "schema": [
        {
          "column_name": "id",
          "data_type": "integer",
          "is_nullable": false,
          "is_primary": true
        },
        {
          "column_name": "name",
          "data_type": "character varying",
          "is_nullable": false,
          "character_maximum_length": 255
        }
      ],
      "label_field": "name",
      "searchable_fields": ["name", "city"],
      "soft_delete": false,
      "temporal_fields": null
    }
  },
  "relations": [
    {
      "from": "sites.venue_id",
      "to": "venues.id",
      "type": "many_to_one"
    }
  ],
  "operations": ["get", "save", "delete", "lookup", "search"]
}
```

From this, we generate:
- Form fields with correct input types
- Validation rules
- Foreign key dropdowns
- Searchable columns
- Navigation links
- Permission checks

## Advanced Features

### Real-time Collaboration
Multiple users see updates instantly via WebSocket broadcasts.

### Temporal Queries
If your entity has temporal fields, you get automatic time-travel UI.

### Soft Deletes
If soft_delete is enabled, deleted items are hidden but recoverable.

### Permission Integration
UI automatically hides/disables operations the user can't perform.

### Relationship Navigation
Click any foreign key value to navigate to that entity.

### Smart Defaults
- Text fields → text inputs
- Numbers → number inputs with step
- Booleans → checkboxes
- Dates → date pickers
- FKs → autocomplete dropdowns
- Long text → textareas
- JSON → syntax-highlighted editors (future)

## Comparison

| Feature | Django Admin | DZQL Admin |
|---------|-------------|------------|
| Configuration Required | Yes, extensive | No |
| Works with any DB | Django ORM only | Any Postgres via DZQL |
| Real-time updates | No | Yes (WebSocket) |
| Client-side | No | Yes (Vue) |
| Type safety | Python | TypeScript-ready |
| Customization | Python classes | Optional JSON |
| Foreign keys | Manual config | Auto-detected |
| Permissions | Manual | Auto-integrated |
| Build step | Yes | No |

## Future Vision

With AI assistance, we can evolve beyond even this:

```js
// Future: Natural language config
createDZQLAdmin(ws, {
  "For venues, show them on a map by default",
  "Group products by category in the sidebar",
  "Make the user profile editable inline"
})

// AI interprets intent and generates config
```

Or even:

```js
// Future: Zero code
// Just open http://localhost:3000/admin
// DZQL serves the admin UI automatically
```

## Examples

See `examples/` directory:
- `zero-config.html` - Simplest possible setup
- `with-config.html` - Optional customization
- `advanced.html` - Advanced features

## Contributing

The beauty of metadata-driven UI is that improvements benefit everyone automatically. No need to update config files across projects.

## License

MIT

---

**Remember:** The best configuration is no configuration at all.
