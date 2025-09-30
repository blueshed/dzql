# DZQL GenUX - TODO & Context

## Project Overview
A fully generative UI system built with Vue 3 + Pinia that dynamically creates interfaces from DZQL metadata. The system reads entity metadata to understand relationships, permissions, and navigation paths, then generates appropriate UI surfaces automatically.

## Current Status ✅

### Architecture Complete
- **WebSocket Integration**: Uses existing `useWs()` from `dzql/client`
- **Pinia Stores**: All core stores implemented following existing patterns
- **CSS Framework**: Complete design system with variables, layout, and surface styles
- **Vue 3 Setup**: Package.json, vite config, and main app structure ready

### Files Created
```
packages/genux/
├── package.json           ✅ Vue 3 + Pinia dependencies
├── vite.config.js         ✅ Dev config with proxy to :3000
├── index.html             ✅ App entry point
├── src/
│   ├── main.js            ✅ Vue app initialization
│   ├── App.vue            ✅ Main app component (references missing components)
│   ├── stores/
│   │   ├── websocket.js   ✅ Uses existing DZQL WebSocket
│   │   ├── metadata.js    ✅ Calls get_entities_metadata()
│   │   ├── data.js        ✅ CRUD operations with caching
│   │   ├── navigation.js  ✅ Graph navigation & breadcrumbs
│   │   └── guards.js      ✅ Permission visualization
│   └── styles/
│       ├── variables.css  ✅ Complete CSS variables system
│       ├── layout.css     ✅ Grid layout & components
│       └── surfaces.css   ✅ Surface-specific styles
```

### Integration Points
- Uses existing `WebSocketManager` from `packages/dzql/src/client/ws.js`
- Follows pattern from `packages/client/src/stores/main.js`
- Connects to existing DZQL backend on localhost:3000
- Reads metadata via `get_entities_metadata()` call

## Next Steps 🚀

### Phase 1: Basic Components (Week 1)
```
src/components/
├── Welcome.vue              🔲 Landing page for new users
├── UserMenu.vue             🔲 User profile/logout dropdown
├── Breadcrumbs.vue          🔲 Navigation breadcrumb trail
├── LoadingOverlay.vue       🔲 Full-screen loading state
├── ToastContainer.vue       🔲 Notification system
├── GlobalMap.vue            🔲 Graph visualization overlay
├── SearchModal.vue          🔲 Global search interface
└── NodeContainer.vue        🔲 Main content area wrapper
```

### Phase 2: Surface Components (Week 2-3)
```
src/components/surfaces/
├── TableSurface.vue         🔲 Data grid with sorting/filtering
├── MapSurface.vue           🔲 Mapbox integration for geo data
├── KanbanSurface.vue        🔲 Drag-drop kanban boards
├── CalendarSurface.vue      🔲 Calendar view for temporal data
├── GanttSurface.vue         🔲 Timeline view for duration data
└── FormSurface.vue          🔲 Dynamic forms for CRUD ops
```

### Phase 3: Support Components (Week 4)
```
src/components/
├── ActionsPanel.vue         🔲 CRUD action buttons with guards
├── FacetsPanel.vue          🔲 FK includes & related data
├── NavigationPanel.vue      🔲 Available navigation options
├── FilterPanel.vue          🔲 Advanced filtering interface
├── CellRenderer.vue         🔲 Dynamic cell content rendering
├── SortIndicator.vue        🔲 Table sort direction indicator
├── Pagination.vue           🔲 Data pagination controls
└── SurfaceSelector.vue      🔲 Switch between surface types
```

### Phase 4: Composables (Week 5)
```
src/composables/
├── useSurface.js            🔲 Common surface logic
├── useGuards.js             🔲 Permission checking helpers
├── useNavigation.js         🔲 Navigation state management
├── useBroadcast.js          🔲 Real-time update handling
├── useFilters.js            🔲 Search & filter logic
└── useSelection.js          🔲 Multi-select functionality
```

## Key Implementation Details

### Surface Type Detection
```javascript
function getSurfaceType(entity) {
  const hints = entityConfig.ui_hints || {}
  const schema = entitySchema || []
  
  if (hints.geo_fields?.length > 0) return 'map'           // venues
  if (hints.temporal_fields?.length > 1) return 'gantt'   // allocations
  if (hints.temporal_fields?.length === 1) return 'calendar'
  if (hasStatusField(schema)) return 'kanban'             // packages
  return 'table'                                          // default
}
```

### Navigation Pattern
```javascript
// Navigate via entity root
navigation.navigate('venues.id')

// Navigate via relationship
navigation.navigate('organisations.id→venues.org_id') 

// Carry context (filters, selections)
navigation.navigate('sites.id', { venueId: 123 })
```

### DZQL API Usage
```javascript
// Uses existing ws.api structure
const venues = await ws.api.search.venues({
  filters: { city: 'NYC', capacity: { gte: 1000 } },
  sort: { field: 'name', order: 'asc' },
  page: 1, limit: 25
})

const venue = await ws.api.get.venues({ id: 123 })
const saved = await ws.api.save.venues({ name: 'MSG', org_id: 1 })
```

### Permission Guards
```javascript
const guard = guards.canPerform('venues', 'create')
if (guard.allowed) {
  // Show create button
} else {
  // Show disabled with tooltip: guard.reason
}
```

## Testing Strategy

### Development Setup
```bash
cd packages/genux
bun install
bun dev  # Starts on :5173 with proxy to :3000
```

### Test Data Requirements
- Existing DZQL backend running on localhost:3000
- Sample data in venues, organisations, packages, etc.
- User authentication working
- `get_entities_metadata()` returning full meta.json structure

### Integration Points to Verify
1. WebSocket connection and auth
2. Metadata loading on connection
3. CRUD operations via ws.api
4. Real-time broadcasts working
5. Permission paths evaluation

## Design Principles

### Zero Hardcoding
- Every UI element derives from metadata
- No entity-specific components
- Surface selection based on schema analysis

### Reactive State
- All data flows through Pinia stores
- WebSocket broadcasts trigger automatic updates
- Optimistic updates for better UX

### Graph Navigation
- UI follows navigationGraph structure
- Breadcrumbs show current path
- Context preserved across navigation

### Permission Transparency
- Guards visible as button states
- Explanations in tooltips
- Notification previews before actions

## Architecture Decisions Made

### Vue 3 + Pinia vs Plain JS
✅ **Chose Vue 3 + Pinia** for:
- Better state management and reactivity
- Component reusability 
- Developer experience
- Follows existing project patterns

### CSS Architecture
✅ **CSS Variables + BEM-style classes**:
- Theme switching support
- Consistent spacing/colors
- Surface-specific styles
- Responsive design built-in

### WebSocket Integration  
✅ **Use existing WebSocketManager**:
- Proven reliability
- Already handles reconnection
- DZQL API structure established
- Authentication integrated

## Potential Challenges

### Performance
- Large datasets in tables
- Real-time updates frequency
- Memory usage with caching
- **Solution**: Virtual scrolling, debounced updates, cache limits

### Complex Relationships
- Deep navigation paths
- Circular references
- Permission inheritance
- **Solution**: Path depth limits, cycle detection, explicit rules

### Mobile Experience
- Touch interactions
- Responsive surfaces
- Navigation patterns
- **Solution**: Mobile-first CSS, touch events, collapsible panels

## Success Metrics

1. **Zero Hardcoded Entities**: 100% UI generated from metadata
2. **Navigation Coverage**: All graph paths accessible via UI
3. **Permission Transparency**: Every denied action explained
4. **Real-time Sync**: <100ms from broadcast to UI update
5. **Surface Accuracy**: Correct visualization for each data type

## Future Enhancements (Post-MVP)

### Advanced Features
- Custom surface plugins
- Workflow templates
- AI-assisted navigation
- Advanced filtering (GraphQL-like)
- Offline support with sync

### Enterprise Features  
- Multi-tenant support
- Audit trail visualization
- Advanced permissions
- Custom themes
- Export/import capabilities

---

**Last Updated**: 2024-01-14
**Status**: Ready for Phase 1 implementation (using Bun)
**Next Action**: Run `bun install` then create basic Vue components