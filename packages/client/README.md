# DZQL Dynamic Client Framework

## Philosophy
A tight, working core with obvious extension points. Zero config to start, progressive enhancement as needed.

## Core Principle
**It just works** - then you customize only what's different about your domain.

## The Framework

### 1. Core Component - Works Immediately
```vue
<!-- This is a fully functional CRUD interface -->
<DynamicEntity entity="venues" />
```

That's it. You get:
- ✅ **Searchable table** with debounced text search
- ✅ **Sortable columns** with visual indicators
- ✅ **Pagination** with page navigation
- ✅ **Real-time updates** via WebSocket broadcasts
- ✅ **Mobile-responsive** design
- 🔄 Create/Edit forms (coming next)
- 🔄 Lookups for foreign keys (coming next)

### 2. Progressive Enhancement

```javascript
// Start with the default
<DynamicEntity entity="allocations" />

// Override just the view
<DynamicEntity
  entity="allocations"
  view="grid"  // or custom AllocationBuilder component
/>

// Override specific fields
<DynamicEntity
  entity="sites"
  fields={{
    position: FloorPlanPicker,  // drag on a floor plan
    venue_id: VenueMap          // pick from a map
  }}
/>

// Add domain operations
<DynamicEntity
  entity="packages"
  actions={{
    duplicate: (record) => duplicateWithAllocations(record),
    optimize: (record) => optimizePackage(record)
  }}
/>
```

## Extension Points

### Field Renderers
```javascript
// Register once, use everywhere
registerField('venue_position', FloorPlanPicker);
registerField('temporal_range', DateRangePicker);
registerField('user_avatar', AvatarUploader);
```

### View Types
```javascript
// Built-in views
'table'    // Default - sortable columns
'cards'    // Grid of cards
'list'     // Simple list

// Register custom views
registerView('kanban', KanbanBoard);
registerView('timeline', TimelineView);
registerView('calendar', CalendarView);
```

### Lookup Strategies
```javascript
// Default: Simple typeahead
registerLookup('default', TypeaheadLookup);

// Custom lookups for specific relationships
registerLookup('venues.areas', AreaTreePicker);
registerLookup('tasks.assigned_to', TeamMemberPicker);
```

## What Makes This Different

### 1. **Not Another Admin Builder**
- Designed for domain-specific apps, not generic admin
- Real-time collaboration built in
- Temporal queries native

### 2. **DZQL's 5 Operations Are The API**
```javascript
// Everything goes through these
ws.api.get.venues({id: 1})
ws.api.save.venues({id: 1, name: 'Updated'})
ws.api.delete.venues({id: 1})
ws.api.lookup.venues({p_filter: 'madison'})
ws.api.search.venues({filters: {...}})
```

### 3. **Metadata + Hints = UI**
```javascript
// Metadata (from database)
{
  label_field: "name",
  searchable_fields: ["name", "address"],
  fk_includes: {"org": "organisations"},
  temporal_fields: {"valid_from": "valid_from"}
}

// + Hints (from config)
{
  primary: ['venues', 'packages'],
  display: {'tasks': 'kanban'},
  icons: {'venues': 'building'}
}

// = Generated UI
<Navigation items={primary} />
<KanbanView entity="tasks" />
```

## Rich Interactions Out of the Box

### Drag & Drop
```javascript
// Just save the new position/relationship
onDrop={(item, target) => {
  ws.api.save[entity]({id: item.id, ...target});
}}
```

### Real-time Collaboration
```javascript
// Everyone sees changes immediately
ws.onBroadcast((method, params) => {
  if (method === `${entity}:update`) {
    refreshRecord(params.pk);
  }
});
```

### Temporal Navigation
```javascript
// Built into the API
ws.api.get.contractor_rights({
  id: 1,
  on_date: '2023-06-15'  // See historical state
});
```

## Example: Complete App

```javascript
import { DZQLClient, DynamicApp } from 'dzql-client';
import { uiConfig } from './ui.config.js';

// Custom components for your domain
import { AllocationBuilder } from './views/AllocationBuilder';
import { VenueFloorPlan } from './fields/VenueFloorPlan';

// Register customizations
const customizations = {
  views: {
    allocations: AllocationBuilder
  },
  fields: {
    'sites.position': VenueFloorPlan
  }
};

// The entire app
function App() {
  const client = new DZQLClient(ws);

  return (
    <DynamicApp
      client={client}
      config={uiConfig}
      customizations={customizations}
    />
  );
}
```

## Why This Works

1. **Sensible Defaults** - Table view, text fields, typeahead lookups
2. **Clear Override Points** - Replace just what's different
3. **Domain Operations** - Call custom functions alongside CRUD
4. **No Build Complexity** - Plain JavaScript, no TypeScript
5. **Progressive** - Start simple, enhance as needed

## What We're NOT Building

- ❌ Another React Admin clone
- ❌ A generic form builder
- ❌ A low-code platform
- ❌ A TypeScript monument

## What We ARE Building

- ✅ A domain-specific app framework
- ✅ Rich interactions (drag-drop, real-time)
- ✅ Temporal-aware interfaces
- ✅ Collaboration-first design
- ✅ Plain JavaScript that just works

## Current Implementation Status

### ✅ **Foundation Complete**
- **Authentication**: Login/Register with JWT tokens
- **WebSocket Client**: Persistent connection with auto-reconnect
- **Dynamic Navigation**: Config-driven navbar with feather icons
- **Routing**: Single regex route `/:entity` handles all entities
- **Profile Store**: Pinia store for user state management

### ✅ **Dynamic Entity System**
- **Entity Store Factory**: Pinia stores created dynamically per entity
- **DynamicEntity Component**: Route-driven entity interface
- **DynamicTable Component**: Full-featured data table with:
  - Text search with debounced input
  - Sortable columns with visual indicators
  - Pagination with page navigation
  - Edit/Delete action buttons
  - Mobile-responsive design
  - Loading states and error handling
  - Empty state with create action

### ✅ **UI Configuration System**
```javascript
// stores/ui-config.js
export const uiConfig = {
  primary: ['venues', 'users'],           // Navigation entities
  display: { 'venues': 'table' },        // Default view types
  icons: {                                // Entity icons (feather icons)
    'venues': markRaw(MapPinIcon),
    'users': markRaw(UsersIcon)
  },
  app: { name: 'DZQL', theme: 'light' }
}
```

### ✅ **DZQL Integration**
All 5 DZQL operations implemented in entity stores:
```javascript
const store = useEntityStore('venues')
await store.search({ filters: { name: 'Madison' }, page: 1 })
await store.get(1)
await store.save({ id: 1, name: 'Updated' })
await store.delete(1)
await store.lookup({ p_filter: 'concert' })
```

### 🔄 **Next Priorities**
1. **Create/Edit Forms**: Modal forms for entity CRUD
2. **Field Renderers**: Input components for different field types
3. **Foreign Key Lookups**: Typeahead components for relationships
4. **View Types**: Cards, list, and custom view implementations
5. **Real-time Optimizations**: Granular update handling

## Current Architecture

### **File Structure**
```
packages/client/src/
├── components/
│   ├── LoginView.vue          # Authentication interface
│   ├── Navbar.vue            # Dynamic navigation
│   ├── DynamicEntity.vue     # Entity route handler
│   └── DynamicTable.vue      # Table view component
├── stores/
│   ├── main.js               # Profile store (user state)
│   ├── ui-config.js          # UI configuration
│   └── entityFactory.js      # Dynamic entity stores
└── main.js                   # App setup with dynamic routing
```

### **Data Flow**
1. **Route**: `/:entity` → `DynamicEntity.vue`
2. **Store**: `useEntityStore(entity)` → Pinia store instance
3. **Component**: `DynamicTable` → Renders data with actions
4. **WebSocket**: Real-time updates → Store refresh → UI update

### **Icon System**
- **Entity icons**: Defined in `ui-config.js` with `markRaw()`
- **UI icons**: Imported per-component from feather-icons
- **SVG Loader**: Optimizes all icons via Vite plugin
- **Consistent**: All icons use same import/usage pattern
