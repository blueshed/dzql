/**
 * Legacy Meta Store - Adapter to Canonical useAppStore
 *
 * This store provides backward compatibility for existing components
 * while using the canonical useAppStore internally.
 */
import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useAppStore, useWsStore } from 'dzql/client/stores'
import { uiConfig } from './ui-config.js'
import BoxIcon from 'feather-icons/dist/icons/box.svg?component'

export const useMetaStore = defineStore('meta', () => {
  // Use canonical stores
  const appStore = useAppStore()
  const wsStore = useWsStore()

  // Adapter: map appStore state to legacy format
  const metadata = computed(() => {
    if (!appStore.entityMetadata || Object.keys(appStore.entityMetadata).length === 0) {
      return null
    }
    return {
      entities: appStore.entityMetadata,
      relations: [], // TODO: Extract from metadata if available
      operations: ['get', 'save', 'delete', 'lookup', 'search']
    }
  })

  const loading = computed(() => appStore.isLoadingMetadata)
  const error = computed(() => null) // appStore doesn't expose error state

  // Override fetch method to call correct function name
  const fetchMetadata = async () => {
    const ws = wsStore.getWs()

    if (!wsStore.isConnected) {
      console.warn('[MetaStore] Cannot fetch metadata: not connected')
      return
    }

    try {
      // Call the correct function name: get_entities_metadata (not 'meta')
      const result = await ws.call('get_entities_metadata', {})

      if (result && result.entities) {
        // Map array or object format to appStore format
        const entitiesObj = {}
        if (Array.isArray(result.entities)) {
          result.entities.forEach(entity => {
            entitiesObj[entity.table_name] = entity
          })
        } else {
          // Already in object format (from new get_entities_metadata function)
          Object.assign(entitiesObj, result.entities)
        }

        // Update appStore state directly
        appStore.entityMetadata = entitiesObj
        console.log('[MetaStore] Metadata loaded:', Object.keys(entitiesObj))
      }
    } catch (err) {
      console.error('[MetaStore] Failed to fetch metadata:', err)
    }
  }

  // Computed helpers
  const entities = computed(() => {
    return metadata.value?.entities || {}
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
