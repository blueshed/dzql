# Generative UX Implementation Plan (Vue 3 + Pinia)

## Executive Summary

A fully generative UI system built with Vue 3 and Pinia that dynamically creates interfaces from DZQL metadata. The system reads `meta.json` to understand entities, relationships, permissions, and navigation paths, then generates appropriate UI surfaces using Vue components based on schema semantics and UI hints.

## Core Principles

1. **Zero Hardcoding**: Every UI element derives from metadata
2. **Reactive State**: Pinia stores manage all state with Vue reactivity
3. **Composable Architecture**: Vue 3 Composition API for reusable logic
4. **Navigation as Graph**: UI follows the navigation graph structure
5. **Permissions as First-Class**: Guards visible and explained in UI
6. **Real-time Updates**: WebSocket broadcasts trigger reactive updates

## Architecture

### 1. Pinia Stores

#### Metadata Store (`/packages/genux/stores/metadata.js`)

```javascript
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export const useMetadataStore = defineStore('metadata', () => {
  // State
  const meta = ref(null)
  const loading = ref(false)
  const error = ref(null)
  
  // Getters
  const entities = computed(() => meta.value?.entities || [])
  const relations = computed(() => meta.value?.relations || [])
  const schema = computed(() => meta.value?.schema || {})
  const navigationGraph = computed(() => meta.value?.navigationGraph || {})
  
  // Actions
  async function loadMetadata() {
    loading.value = true
    try {
      const response = await fetch('/meta.json')
      meta.value = await response.json()
    } catch (e) {
      error.value = e
    } finally {
      loading.value = false
    }
  }
  
  function getEntity(tableName) {
    return entities.value.find(e => e.table_name === tableName)
  }
  
  function getSurfaceType(entity) {
    const config = getEntity(entity)
    const hints = config?.ui_hints || {}
    const schemaFields = schema.value[entity] || []
    
    // Priority order for surface selection
    if (hints.geo_fields?.length > 0) return 'map'
    if (hints.temporal_fields?.length > 1) return 'gantt'
    if (hints.temporal_fields?.length === 1) return 'calendar'
    if (hasStatusField(schemaFields)) return 'kanban'
    return 'table'
  }
  
  function hasStatusField(fields) {
    return fields.some(f => 
      f.column_name === 'status' || 
      f.column_name.endsWith('_status')
    )
  }
  
  return {
    meta,
    loading,
    error,
    entities,
    relations,
    schema,
    navigationGraph,
    loadMetadata,
    getEntity,
    getSurfaceType
  }
})
```

#### Navigation Store (`/packages/genux/stores/navigation.js`)

```javascript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useMetadataStore } from './metadata'

export const useNavigationStore = defineStore('navigation', () => {
  const metadataStore = useMetadataStore()
  
  // State
  const currentPath = ref(null)
  const history = ref([])
  const context = ref({})
  
  // Getters
  const currentNode = computed(() => 
    currentPath.value ? metadataStore.navigationGraph[currentPath.value] : null
  )
  
  const currentEntity = computed(() => currentNode.value?.current_entity)
  
  const breadcrumbs = computed(() => currentNode.value?.breadcrumb || [])
  
  const availableActions = computed(() => currentNode.value?.available_actions || [])
  
  const navigationOptions = computed(() => currentNode.value?.navigation_options || [])
  
  // Actions
  function navigate(path, carryContext = {}) {
    if (currentPath.value) {
      history.value.push(currentPath.value)
    }
    currentPath.value = path
    context.value = { ...context.value, ...carryContext }
  }
  
  function back() {
    if (history.value.length > 0) {
      currentPath.value = history.value.pop()
    }
  }
  
  function setContext(key, value) {
    context.value[key] = value
  }
  
  return {
    currentPath,
    history,
    context,
    currentNode,
    currentEntity,
    breadcrumbs,
    availableActions,
    navigationOptions,
    navigate,
    back,
    setContext
  }
})
```

#### Data Store (`/packages/genux/stores/data.js`)

```javascript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWebSocketStore } from './websocket'

export const useDataStore = defineStore('data', () => {
  const ws = useWebSocketStore()
  
  // State
  const cache = ref(new Map())
  const loading = ref(new Set())
  const errors = ref(new Map())
  
  // Actions
  async function fetch(entity, operation = 'search', params = {}) {
    const key = `${entity}:${operation}:${JSON.stringify(params)}`
    loading.value.add(key)
    
    try {
      const result = await ws.api[operation][entity](params)
      cache.value.set(key, result)
      return result
    } catch (error) {
      errors.value.set(key, error)
      throw error
    } finally {
      loading.value.delete(key)
    }
  }
  
  async function save(entity, data) {
    const result = await ws.api.save[entity](data)
    invalidateCache(entity)
    return result
  }
  
  async function remove(entity, id) {
    const result = await ws.api.delete[entity]({ id })
    invalidateCache(entity)
    return result
  }
  
  function invalidateCache(entity) {
    for (const [key] of cache.value) {
      if (key.startsWith(`${entity}:`)) {
        cache.value.delete(key)
      }
    }
  }
  
  function getCached(entity, operation, params) {
    const key = `${entity}:${operation}:${JSON.stringify(params)}`
    return cache.value.get(key)
  }
  
  function isLoading(entity, operation, params) {
    const key = `${entity}:${operation}:${JSON.stringify(params)}`
    return loading.value.has(key)
  }
  
  return {
    cache,
    loading,
    errors,
    fetch,
    save,
    remove,
    invalidateCache,
    getCached,
    isLoading
  }
})
```

#### WebSocket Store (`/packages/genux/stores/websocket.js`)

```javascript
import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { WebSocketManager } from '../utils/websocket'

export const useWebSocketStore = defineStore('websocket', () => {
  // State
  const ws = ref(null)
  const connected = ref(false)
  const user = ref(null)
  const api = reactive({})
  
  // Actions
  async function connect() {
    ws.value = new WebSocketManager()
    await ws.value.connect()
    connected.value = true
    
    // Set up proxy API
    Object.assign(api, ws.value.api)
    
    // Set up broadcast handler
    ws.value.onBroadcast((method, params) => {
      handleBroadcast(method, params)
    })
  }
  
  async function login(email, password) {
    const result = await ws.value.call('login_user', { email, password })
    user.value = result.user
    return result
  }
  
  function handleBroadcast(method, params) {
    // Emit events that components can listen to
    const [entity, operation] = method.split(':')
    window.dispatchEvent(new CustomEvent('dzql:broadcast', {
      detail: { entity, operation, params }
    }))
  }
  
  return {
    ws,
    connected,
    user,
    api,
    connect,
    login
  }
})
```

#### Guards Store (`/packages/genux/stores/guards.js`)

```javascript
import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useMetadataStore } from './metadata'
import { useWebSocketStore } from './websocket'

export const useGuardsStore = defineStore('guards', () => {
  const metadata = useMetadataStore()
  const ws = useWebSocketStore()
  
  // Computed
  const currentUserId = computed(() => ws.user?.id)
  
  // Actions
  function canPerform(entity, action, record = null) {
    const config = metadata.getEntity(entity)
    const paths = config?.permission_paths?.[action] || []
    
    // No paths means unrestricted
    if (paths.length === 0) return { allowed: true }
    
    // Check if any path would allow (simplified)
    // In real implementation, would evaluate paths against record
    if (paths.includes('@user_id') && currentUserId.value) {
      return { allowed: true }
    }
    
    return {
      allowed: false,
      reason: explainGuard(entity, action, paths)
    }
  }
  
  function explainGuard(entity, action, paths) {
    const explanations = {
      create: `Creating ${entity} requires membership in the target organization`,
      update: `Updating ${entity} requires ownership or delegation rights`,
      delete: `Deleting ${entity} requires ownership rights`,
      view: `Viewing ${entity} may be restricted by organization membership`
    }
    
    return explanations[action] || `Action ${action} is restricted`
  }
  
  function getNotificationPreview(entity, action, data) {
    const config = metadata.getEntity(entity)
    const paths = config?.notification_paths || {}
    
    const preview = {}
    for (const [channel, pathList] of Object.entries(paths)) {
      // Simplified - would actually resolve paths
      preview[channel] = pathList.length
    }
    
    return preview
  }
  
  return {
    currentUserId,
    canPerform,
    explainGuard,
    getNotificationPreview
  }
})
```

### 2. Vue Components

#### App Component (`/packages/genux/App.vue`)

```vue
<template>
  <div class="genux-app">
    <!-- Global Map Overlay -->
    <GlobalMap v-if="showGlobalMap" @close="showGlobalMap = false" />
    
    <!-- Main Layout -->
    <div class="app-layout">
      <!-- Header -->
      <header class="app-header">
        <Breadcrumbs />
        <div class="header-actions">
          <button @click="showGlobalMap = true" class="btn-icon">
            <IconMap />
          </button>
          <UserMenu />
        </div>
      </header>
      
      <!-- Main Content -->
      <main class="app-main">
        <NodeContainer v-if="currentEntity" />
        <Welcome v-else />
      </main>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useNavigationStore } from './stores/navigation'
import { useMetadataStore } from './stores/metadata'
import { useWebSocketStore } from './stores/websocket'
import GlobalMap from './components/GlobalMap.vue'
import Breadcrumbs from './components/Breadcrumbs.vue'
import UserMenu from './components/UserMenu.vue'
import NodeContainer from './components/NodeContainer.vue'
import Welcome from './components/Welcome.vue'

const navigation = useNavigationStore()
const metadata = useMetadataStore()
const ws = useWebSocketStore()

const showGlobalMap = ref(false)
const currentEntity = computed(() => navigation.currentEntity)

onMounted(async () => {
  await metadata.loadMetadata()
  await ws.connect()
})
</script>
```

#### Node Container (`/packages/genux/components/NodeContainer.vue`)

```vue
<template>
  <div class="node-container">
    <div class="node-layout">
      <!-- Main Surface Area -->
      <section class="surface-area">
        <SurfaceSelector 
          :entity="currentEntity"
          :surface-type="surfaceType"
          @change="surfaceType = $event"
        />
        <component 
          :is="surfaceComponent" 
          :entity="currentEntity"
          :config="entityConfig"
          :schema="entitySchema"
        />
      </section>
      
      <!-- Actions Panel -->
      <aside class="actions-panel">
        <ActionsPanel 
          :entity="currentEntity"
          :actions="availableActions"
          :selection="selection"
        />
      </aside>
      
      <!-- Facets Panel -->
      <aside class="facets-panel">
        <FacetsPanel 
          :entity="currentEntity"
          :config="entityConfig"
          :selection="selection"
        />
      </aside>
      
      <!-- Navigation Panel -->
      <nav class="navigation-panel">
        <NavigationPanel 
          :options="navigationOptions"
          :context="context"
        />
      </nav>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useNavigationStore } from '../stores/navigation'
import { useMetadataStore } from '../stores/metadata'
import SurfaceSelector from './SurfaceSelector.vue'
import ActionsPanel from './ActionsPanel.vue'
import FacetsPanel from './FacetsPanel.vue'
import NavigationPanel from './NavigationPanel.vue'

// Dynamic imports for surfaces
import TableSurface from './surfaces/TableSurface.vue'
import MapSurface from './surfaces/MapSurface.vue'
import KanbanSurface from './surfaces/KanbanSurface.vue'
import CalendarSurface from './surfaces/CalendarSurface.vue'
import GanttSurface from './surfaces/GanttSurface.vue'

const navigation = useNavigationStore()
const metadata = useMetadataStore()

const currentEntity = computed(() => navigation.currentEntity)
const entityConfig = computed(() => metadata.getEntity(currentEntity.value))
const entitySchema = computed(() => metadata.schema[currentEntity.value])
const availableActions = computed(() => navigation.availableActions)
const navigationOptions = computed(() => navigation.navigationOptions)
const context = computed(() => navigation.context)

const surfaceType = ref(null)
const selection = ref(new Set())

// Surface component mapping
const surfaceComponents = {
  table: TableSurface,
  map: MapSurface,
  kanban: KanbanSurface,
  calendar: CalendarSurface,
  gantt: GanttSurface
}

const surfaceComponent = computed(() => 
  surfaceComponents[surfaceType.value] || TableSurface
)

// Auto-detect surface type when entity changes
watch(currentEntity, (entity) => {
  if (entity) {
    surfaceType.value = metadata.getSurfaceType(entity)
    selection.value.clear()
  }
})
</script>
```

#### Table Surface (`/packages/genux/components/surfaces/TableSurface.vue`)

```vue
<template>
  <div class="table-surface">
    <!-- Search & Filters -->
    <div class="surface-controls">
      <input 
        v-model="searchQuery"
        type="search" 
        :placeholder="`Search ${entity}...`"
        class="search-input"
      >
      <button @click="showFilters = !showFilters" class="btn-filter">
        <IconFilter /> Filters
      </button>
    </div>
    
    <!-- Filters Panel -->
    <FilterPanel 
      v-if="showFilters"
      :schema="schema"
      v-model="filters"
      @apply="applyFilters"
    />
    
    <!-- Data Table -->
    <div class="table-wrapper">
      <table class="data-table">
        <thead>
          <tr>
            <th class="checkbox-col">
              <input 
                type="checkbox" 
                @change="toggleSelectAll"
                :checked="allSelected"
              >
            </th>
            <th 
              v-for="col in columns" 
              :key="col.name"
              @click="sortBy(col.name)"
              class="sortable"
            >
              {{ col.label }}
              <SortIndicator 
                :field="col.name" 
                :current="sortField"
                :order="sortOrder"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr 
            v-for="row in data.items" 
            :key="row.id"
            @click="selectRow(row)"
            :class="{ selected: selection.has(row.id) }"
          >
            <td class="checkbox-col">
              <input 
                type="checkbox"
                :checked="selection.has(row.id)"
                @click.stop
                @change="toggleSelection(row.id)"
              >
            </td>
            <td v-for="col in columns" :key="col.name">
              <CellRenderer 
                :value="row[col.name]"
                :type="col.type"
                :config="col"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <!-- Pagination -->
    <Pagination 
      v-model:page="currentPage"
      :total="data.total"
      :limit="pageLimit"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useDataStore } from '../../stores/data'
import FilterPanel from '../FilterPanel.vue'
import CellRenderer from '../CellRenderer.vue'
import SortIndicator from '../SortIndicator.vue'
import Pagination from '../Pagination.vue'

const props = defineProps({
  entity: String,
  config: Object,
  schema: Array
})

const emit = defineEmits(['select'])

const dataStore = useDataStore()

// State
const data = ref({ items: [], total: 0 })
const selection = ref(new Set())
const searchQuery = ref('')
const filters = ref({})
const showFilters = ref(false)
const sortField = ref(props.config?.label_field)
const sortOrder = ref('asc')
const currentPage = ref(1)
const pageLimit = ref(25)

// Computed
const columns = computed(() => 
  props.schema.map(col => ({
    name: col.column_name,
    label: col.column_name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    type: col.data_type
  }))
)

const allSelected = computed(() => 
  data.value.items.length > 0 && 
  data.value.items.every(row => selection.value.has(row.id))
)

// Methods
async function loadData() {
  const params = {
    filters: { ...filters.value },
    sort: { field: sortField.value, order: sortOrder.value },
    page: currentPage.value,
    limit: pageLimit.value
  }
  
  if (searchQuery.value) {
    params.filters._search = searchQuery.value
  }
  
  data.value = await dataStore.fetch(props.entity, 'search', params)
}

function toggleSelectAll() {
  if (allSelected.value) {
    selection.value.clear()
  } else {
    data.value.items.forEach(row => selection.value.add(row.id))
  }
  emit('select', Array.from(selection.value))
}

function toggleSelection(id) {
  if (selection.value.has(id)) {
    selection.value.delete(id)
  } else {
    selection.value.add(id)
  }
  emit('select', Array.from(selection.value))
}

function selectRow(row) {
  selection.value.clear()
  selection.value.add(row.id)
  emit('select', [row.id])
}

function sortBy(field) {
  if (sortField.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = field
    sortOrder.value = 'asc'
  }
  loadData()
}

function applyFilters() {
  currentPage.value = 1
  loadData()
}

// Watchers
watch([searchQuery, currentPage], loadData)

// Lifecycle
onMounted(loadData)

// Listen for broadcasts
window.addEventListener('dzql:broadcast', (event) => {
  if (event.detail.entity === props.entity) {
    loadData()
  }
})
</script>
```

#### Map Surface (`/packages/genux/components/surfaces/MapSurface.vue`)

```vue
<template>
  <div class="map-surface">
    <div ref="mapContainer" class="map-container"></div>
    <div class="map-drawer" :class="{ open: drawerOpen }">
      <div class="drawer-header">
        <h3>{{ entity }} List</h3>
        <button @click="drawerOpen = !drawerOpen" class="btn-toggle">
          <IconChevron :direction="drawerOpen ? 'down' : 'up'" />
        </button>
      </div>
      <div class="drawer-content">
        <div 
          v-for="item in data.items" 
          :key="item.id"
          @click="selectMarker(item)"
          :class="{ selected: selection.has(item.id) }"
          class="map-item"
        >
          <h4>{{ item[config.label_field] }}</h4>
          <p>{{ item[geoField] }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useDataStore } from '../../stores/data'
import mapboxgl from 'mapbox-gl'

const props = defineProps({
  entity: String,
  config: Object,
  schema: Array
})

const dataStore = useDataStore()

// State
const mapContainer = ref(null)
const map = ref(null)
const markers = ref([])
const data = ref({ items: [] })
const selection = ref(new Set())
const drawerOpen = ref(true)

// Computed
const geoField = computed(() => props.config.ui_hints?.geo_fields?.[0] || 'address')

// Methods
async function loadData() {
  data.value = await dataStore.fetch(props.entity, 'search', {})
  createMarkers()
}

async function createMarkers() {
  // Clear existing markers
  markers.value.forEach(m => m.remove())
  markers.value = []
  
  // Create new markers
  for (const item of data.value.items) {
    const coords = await geocode(item[geoField.value])
    if (coords) {
      const marker = new mapboxgl.Marker()
        .setLngLat(coords)
        .setPopup(new mapboxgl.Popup().setHTML(`
          <h3>${item[props.config.label_field]}</h3>
          <p>${item[geoField.value]}</p>
        `))
        .addTo(map.value)
      
      marker.getElement().addEventListener('click', () => {
        selectMarker(item)
      })
      
      markers.value.push(marker)
    }
  }
}

function selectMarker(item) {
  selection.value.clear()
  selection.value.add(item.id)
  
  // Pan to marker
  const coords = markers.value[data.value.items.indexOf(item)]?.getLngLat()
  if (coords) {
    map.value.flyTo({ center: coords, zoom: 15 })
  }
}

async function geocode(address) {
  // Simplified - would use real geocoding service
  return [-74.006, 40.7128] // NYC coordinates as placeholder
}

// Lifecycle
onMounted(() => {
  map.value = new mapboxgl.Map({
    container: mapContainer.value,
    style: 'mapbox://styles/mapbox/streets-v11',
    center: [-74.006, 40.7128],
    zoom: 10
  })
  
  loadData()
})
</script>
```

### 3. Composables

#### Use Surface (`/packages/genux/composables/useSurface.js`)

```javascript
import { ref, computed, watch } from 'vue'
import { useMetadataStore } from '../stores/metadata'
import { useDataStore } from '../stores/data'

export function useSurface(entity) {
  const metadata = useMetadataStore()
  const dataStore = useDataStore()
  
  const surfaceType = ref(null)
  const data = ref([])
  const loading = ref(false)
  const error = ref(null)
  const selection = ref(new Set())
  
  const entityConfig = computed(() => metadata.getEntity(entity.value))
  const schema = computed(() => metadata.schema[entity.value])
  
  watch(entity, async (newEntity) => {
    if (newEntity) {
      surfaceType.value = metadata.getSurfaceType(newEntity)
      await loadData()
    }
  })
  
  async function loadData(params = {}) {
    loading.value = true
    error.value = null
    try {
      data.value = await dataStore.fetch(entity.value, 'search', params)
    } catch (e) {
      error.value = e
    } finally {
      loading.value = false
    }
  }
  
  function selectItem(id) {
    if (selection.value.has(id)) {
      selection.value.delete(id)
    } else {
      selection.value.add(id)
    }
  }
  
  function selectAll() {
    data.value.items?.forEach(item => selection.value.add(item.id))
  }
  
  function clearSelection() {
    selection.value.clear()
  }
  
  return {
    surfaceType,
    data,
    loading,
    error,
    selection,
    entityConfig,
    schema,
    loadData,
    selectItem,
    selectAll,
    clearSelection
  }
}
```

#### Use Guards (`/packages/genux/composables/useGuards.js`)

```javascript
import { computed } from 'vue'
import { useGuardsStore } from '../stores/guards'

export function useGuards(entity) {
  const guards = useGuardsStore()
  
  const canCreate = computed(() => 
    guards.canPerform(entity.value, 'create')
  )
  
  const canUpdate = computed(() => 
    guards.canPerform(entity.value, 'update')
  )
  
  const canDelete = computed(() => 
    guards.canPerform(entity.value, 'delete')
  )
  
  const canView = computed(() => 
    guards.canPerform(entity.value, 'view')
  )
  
  function checkAction(action, record = null) {
    return guards.canPerform(entity.value, action, record)
  }
  
  function getNotificationPreview(action, data) {
    return guards.getNotificationPreview(entity.value, action, data)
  }
  
  return {
    canCreate,
    canUpdate,
    canDelete,
    canView,
    checkAction,
    getNotificationPreview
  }
}
```

## File Structure

```
packages/genux/
├── package.json
├── vite.config.js
├── index.html
├── src/
│   ├── main.js            # Vue app entry
│   ├── App.vue            # Root component
│   ├── stores/
│   │   ├── metadata.js    # Metadata store
│   │   ├── navigation.js  # Navigation store
│   │   ├── data.js        # Data operations store
│   │   ├── websocket.js   # WebSocket store
│   │   └── guards.js      # Guards/permissions store
│   ├── components/
│   │   ├── NodeContainer.vue
│   │   ├── GlobalMap.vue
│   │   ├── Breadcrumbs.vue
│   │   ├── ActionsPanel.vue
│   │   ├── FacetsPanel.vue
│   │   ├── NavigationPanel.vue
│   │   ├── FilterPanel.vue
│   │   ├── CellRenderer.vue
│   │   └── surfaces/
│   │       ├── TableSurface.vue
│   │       ├── MapSurface.vue
│   │       ├── KanbanSurface.vue
│   │       ├── CalendarSurface.vue
│   │       └── GanttSurface.vue
│   ├── composables/
│   │   ├── useSurface.js
│   │   ├── useGuards.js
│   │   ├── useNavigation.js
│   │   └── useBroadcast.js
│   ├── utils/
│   │   ├── websocket.js
│   │   ├── geocoder.js
│   │   └── formatters.js
│   └── styles/
│       ├── variables.css
│       ├── layout.css
│       └── surfaces.css
```

## Implementation Phases

### Phase 1: Core Setup (Week 1)
1. Initialize Vue 3 + Vite project
2. Set up Pinia stores structure
3. Create WebSocket integration
4. Load and parse meta.json

### Phase 2: Navigation System (Week 2)
1. Implement navigation store
2. Build breadcrumb component
3. Create global map visualization
4. Add navigation panel

### Phase 3: Data Layer (Week 3)
1. Implement data store with caching
2. Create CRUD operations
3. Add optimistic updates
4. Set up broadcast handlers

### Phase 4: Surface Components (Week 4-5)
1. Build TableSurface with filtering/sorting
2. Create MapSurface with geocoding
3. Implement KanbanSurface with drag-drop
4. Add CalendarSurface
5. Build GanttSurface for temporal data

### Phase 5: Guards & Permissions (Week 6)
1. Implement guards store
2. Add permission checking to actions
3. Create explanation tooltips
4. Build notification preview

### Phase 6: Facets & Relations (Week 7)
1. Build FK include system
2. Create related data panels
3. Add collection displays
4. Implement audit trail viewer

### Phase 7: Polish & Optimization (Week 8)
1. Add transitions and animations