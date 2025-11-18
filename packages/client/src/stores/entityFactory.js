import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWsStore } from 'dzql/client/stores'

const storeCache = new Map()

export const useEntityStore = (entityName) => {
  if (!storeCache.has(entityName)) {
    const store = defineStore(`entity-${entityName}`, () => {
      // Use canonical store to get WebSocket instance
      const wsStore = useWsStore()
      const ws = wsStore.getWs()

      // State
      const records = ref([])
      const loading = ref(false)
      const error = ref(null)
      const searchParams = ref({
        filters: {},
        sort: null,
        page: 1,
        limit: 25
      })
      const searchResults = ref(null)

      // Computed
      const hasData = computed(() => records.value.length > 0)
      const totalPages = computed(() => {
        if (!searchResults.value) return 0
        return Math.ceil(searchResults.value.total / searchResults.value.limit)
      })

      // Actions
      const clearError = () => {
        error.value = null
      }

      const search = async (params = {}) => {
        loading.value = true
        error.value = null

        try {
          // Merge with current search params
          const searchQuery = {
            ...searchParams.value,
            ...params
          }

          // Update stored params
          searchParams.value = { ...searchQuery }

          console.log(`Searching ${entityName}:`, searchQuery)
          const result = await ws.api.search[entityName](searchQuery)

          records.value = result.data || []
          searchResults.value = result

          return result
        } catch (err) {
          console.error(`Search error for ${entityName}:`, err)
          error.value = err.message || 'Search failed'
          records.value = []
          searchResults.value = null
        } finally {
          loading.value = false
        }
      }

      const get = async (id, params = {}) => {
        loading.value = true
        error.value = null

        try {
          console.log(`Getting ${entityName} by id:`, id)
          const result = await ws.api.get[entityName]({ id, ...params })
          return result
        } catch (err) {
          console.error(`Get error for ${entityName}:`, err)
          error.value = err.message || 'Get failed'
          throw err
        } finally {
          loading.value = false
        }
      }

      const save = async (data) => {
        loading.value = true
        error.value = null

        try {
          console.log(`Saving ${entityName}:`, data)
          const result = await ws.api.save[entityName](data)

          // Refresh search results if we have them
          if (searchResults.value) {
            await search(searchParams.value)
          }

          return result
        } catch (err) {
          console.error(`Save error for ${entityName}:`, err)
          error.value = err.message || 'Save failed'
          throw err
        } finally {
          loading.value = false
        }
      }

      const deleteRecord = async (id) => {
        loading.value = true
        error.value = null

        try {
          console.log(`Deleting ${entityName} id:`, id)
          const result = await ws.api.delete[entityName]({ id })

          // Refresh search results
          if (searchResults.value) {
            await search(searchParams.value)
          }

          return result
        } catch (err) {
          console.error(`Delete error for ${entityName}:`, err)
          error.value = err.message || 'Delete failed'
          throw err
        } finally {
          loading.value = false
        }
      }

      const lookup = async (filter) => {
        try {
          console.log(`Lookup ${entityName}:`, filter)
          const result = await ws.api.lookup[entityName]({ p_filter: filter })
          return result
        } catch (err) {
          console.error(`Lookup error for ${entityName}:`, err)
          throw err
        }
      }

      // Real-time update handler
      const handleRealTimeUpdate = (params) => {
        console.log(`Real-time update for ${entityName}:`, params)

        if (params.table === entityName) {
          // Refresh search results if we have active data
          if (searchResults.value && records.value.length > 0) {
            search(searchParams.value)
          }
        }
      }

      return {
        // State
        records,
        loading,
        error,
        searchParams,
        searchResults,

        // Computed
        hasData,
        totalPages,

        // Actions
        search,
        get,
        save,
        delete: deleteRecord,
        lookup,
        clearError,
        handleRealTimeUpdate
      }
    })

    storeCache.set(entityName, store)
  }

  return storeCache.get(entityName)()
}
