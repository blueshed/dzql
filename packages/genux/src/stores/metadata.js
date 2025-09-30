import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWebSocketStore } from './websocket'

export const useMetadataStore = defineStore('metadata', () => {
  const ws = useWebSocketStore()

  // State - use meta from WebSocket store
  const loading = ref(false)
  const error = ref(null)

  // Computed - get meta from WebSocket store
  const meta = computed(() => ws.meta)
  const entities = computed(() => meta.value?.entities || [])
  const relations = computed(() => meta.value?.relations || [])
  const schema = computed(() => meta.value?.schema || {})
  const navigationGraph = computed(() => meta.value?.navigationGraph || {})
  const operations = computed(() => meta.value?.operations || ['get', 'save', 'delete', 'lookup', 'search'])

  // Actions
  async function loadMetadata() {
    if (meta.value) {
      return meta.value // Already loaded
    }

    loading.value = true
    error.value = null

    try {
      // Connect WebSocket if not connected - this will load metadata
      if (!ws.connected) {
        await ws.connect()
      }

      // If still no meta after connection, try direct call
      if (!meta.value && ws.connected) {
        const result = await ws.call('get_entities_metadata', {})
        // The WebSocket store will handle setting meta via broadcast
        return result
      }

      return meta.value
    } catch (e) {
      error.value = e
      console.error('Failed to load metadata:', e)
      throw e
    } finally {
      loading.value = false
    }
  }

  function getEntity(tableName) {
    return entities.value.find(e => e.table_name === tableName)
  }

  function getSurfaceType(entity) {
    const config = getEntity(entity)
    if (!config) return 'table'

    const hints = config.ui_hints || {}
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
      f.column_name.endsWith('_status') ||
      f.column_name.includes('state')
    )
  }

  function getEntitySchema(entity) {
    return schema.value[entity] || []
  }

  function getEntityConfig(entity) {
    return getEntity(entity)
  }

  function getNavigationNode(path) {
    return navigationGraph.value[path] || null
  }

  function getRelationsForEntity(entity) {
    return relations.value.filter(rel =>
      rel.from.startsWith(`${entity}.`) || rel.to.startsWith(`${entity}.`)
    )
  }

  function getEntityColumns(entity) {
    const entitySchema = getEntitySchema(entity)
    return entitySchema.map(col => ({
      name: col.column_name,
      type: col.data_type,
      nullable: col.is_nullable,
      default: col.column_default,
      maxLength: col.character_maximum_length,
      precision: col.numeric_precision,
      scale: col.numeric_scale
    }))
  }

  function getSearchableFields(entity) {
    const config = getEntity(entity)
    return config?.searchable_fields || []
  }

  function getLabelField(entity) {
    const config = getEntity(entity)
    return config?.label_field || 'name'
  }

  function getForeignKeyIncludes(entity) {
    const config = getEntity(entity)
    return config?.fk_includes || {}
  }

  function getUIHints(entity) {
    const node = Object.values(navigationGraph.value).find(n => n.current_entity === entity)
    return node?.ui_hints || {}
  }

  function formatEntityName(tableName) {
    if (!tableName) return ''
    return tableName
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
  }

  function getEntityIcon(tableName) {
    const icons = {
      organisations: '🏢',
      venues: '📍',
      packages: '📦',
      users: '👤',
      sites: '🏗️',
      products: '🛍️',
      allocations: '📅',
      contractor_rights: '🤝',
      acts_for: '🔗'
    }
    return icons[tableName] || '📄'
  }

  return {
    // State
    loading,
    error,

    // Computed
    meta,
    entities,
    relations,
    schema,
    navigationGraph,
    operations,

    // Actions
    loadMetadata,
    getEntity,
    getSurfaceType,
    getEntitySchema,
    getEntityConfig,
    getNavigationNode,
    getRelationsForEntity,
    getEntityColumns,
    getSearchableFields,
    getLabelField,
    getForeignKeyIncludes,
    getUIHints,
    formatEntityName,
    getEntityIcon
  }
})
