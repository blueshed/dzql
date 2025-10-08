import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWs } from 'dzql/client'
import { uiConfig } from './ui-config.js'
import BoxIcon from 'feather-icons/dist/icons/box.svg?component'

export const useMetaStore = defineStore('meta', () => {
  const ws = useWs()

  // State
  const metadata = ref(null)
  const loading = ref(false)
  const error = ref(null)

  // Fetch metadata via WebSocket
  const fetchMetadata = async () => {
    loading.value = true
    error.value = null

    try {
      console.log('Fetching metadata via WebSocket...')
      const result = await ws.api.get_entities_metadata()
      metadata.value = result
      console.log('Metadata fetched successfully:', result)
    } catch (err) {
      console.error('Failed to fetch metadata:', err)
      error.value = err.message || 'Failed to fetch metadata'
    } finally {
      loading.value = false
    }
  }

  // Computed helpers
  const entities = computed(() => {
    console.log('Computing entities from metadata:', metadata.value)
    const result = metadata.value?.entities || {}
    console.log('Entities object:', result)
    return result
  })

  const entitiesList = computed(() => {
    const list = Object.values(entities.value)
    console.log('Entities list:', list)
    console.log('First entity in list:', list[0])
    console.log('First entity keys:', list[0] ? Object.keys(list[0]) : 'empty')
    return list
  })

  const relations = computed(() => {
    return metadata.value?.relations || []
  })

  const operations = computed(() => {
    return metadata.value?.operations || ['get', 'save', 'delete', 'lookup', 'search']
  })

  // Get entity schema (columns)
  const getEntitySchema = (entityName) => {
    return entities.value[entityName]?.schema || []
  }

  // Get entity permissions
  const getEntityPermissions = (entityName) => {
    return entities.value[entityName]?.permission_paths || {}
  }

  // Get available operations for entity based on permissions
  const getAvailableOperations = (entityName) => {
    const permissions = getEntityPermissions(entityName)
    const available = []

    if (permissions.create && permissions.create.length >= 0) available.push('create')
    if (permissions.view && permissions.view.length >= 0) available.push('view')
    if (permissions.update && permissions.update.length >= 0) available.push('update')
    if (permissions.delete && permissions.delete.length >= 0) available.push('delete')

    return available
  }

  // Get entity icon from ui-config with fallback
  const getEntityIcon = (entityName) => {
    return uiConfig.icons[entityName] || BoxIcon
  }

  // Get related entities (via foreign keys)
  const getRelatedEntities = (entityName) => {
    const related = new Set()

    relations.value.forEach(rel => {
      const fromEntity = rel.from.split('.')[0]
      const toEntity = rel.to.split('.')[0]

      if (fromEntity === entityName) {
        related.add(toEntity)
      }
      if (toEntity === entityName) {
        related.add(fromEntity)
      }
    })

    return Array.from(related)
  }

  // Get foreign key fields for an entity
  const getForeignKeyFields = (entityName) => {
    const fkFields = []

    relations.value.forEach(rel => {
      if (rel.type === 'many_to_one') {
        const fromEntity = rel.from.split('.')[0]
        const fromColumn = rel.from.split('.')[1]
        const toEntity = rel.to.split('.')[0]

        if (fromEntity === entityName) {
          fkFields.push({
            column: fromColumn,
            referencedEntity: toEntity,
            type: 'many_to_one'
          })
        }
      }
    })

    return fkFields
  }

  // Get entity label field
  const getLabelField = (entityName) => {
    return entities.value[entityName]?.label_field || 'id'
  }

  // Get entity searchable fields
  const getSearchableFields = (entityName) => {
    return entities.value[entityName]?.searchable_fields || []
  }

  // Check if entity has temporal fields
  const isTemporalEntity = (entityName) => {
    const temporalFields = entities.value[entityName]?.temporal_fields || {}
    return Object.keys(temporalFields).length > 0
  }

  return {
    // State
    metadata,
    loading,
    error,

    // Actions
    fetchMetadata,

    // Computed
    entities,
    entitiesList,
    relations,
    operations,

    // Helpers
    getEntitySchema,
    getEntityPermissions,
    getAvailableOperations,
    getEntityIcon,
    getRelatedEntities,
    getForeignKeyFields,
    getLabelField,
    getSearchableFields,
    isTemporalEntity
  }
})
