import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWebSocketStore } from './websocket'

export const useDataStore = defineStore('data', () => {
  const ws = useWebSocketStore()

  // State
  const cache = ref(new Map())
  const loading = ref(new Set())
  const errors = ref(new Map())
  const lastFetch = ref(new Map())

  // Cache TTL in milliseconds (5 minutes)
  const CACHE_TTL = 5 * 60 * 1000

  // Computed
  const isConnected = computed(() => ws.connected)

  // Actions
  async function fetch(entity, operation = 'search', params = {}) {
    const key = generateCacheKey(entity, operation, params)

    // Check if already loading
    if (loading.value.has(key)) {
      return waitForLoading(key)
    }

    // Check cache first (if not expired)
    const cached = getCached(entity, operation, params)
    if (cached && !isCacheExpired(key)) {
      return cached
    }

    loading.value.add(key)
    errors.value.delete(key)

    try {
      let result

      // Use the existing DZQL API structure
      if (operation === 'get') {
        result = await ws.api.get[entity](params)
      } else if (operation === 'search') {
        result = await ws.api.search[entity](params)
      } else if (operation === 'lookup') {
        result = await ws.api.lookup[entity](params)
      } else {
        throw new Error(`Unsupported fetch operation: ${operation}`)
      }

      // Cache the result
      cache.value.set(key, result)
      lastFetch.value.set(key, Date.now())

      return result
    } catch (error) {
      errors.value.set(key, error)
      console.error(`Failed to fetch ${entity} (${operation}):`, error)
      throw error
    } finally {
      loading.value.delete(key)
    }
  }

  async function save(entity, data) {
    try {
      const result = await ws.api.save[entity](data)

      // Invalidate related cache entries
      invalidateCache(entity)

      // Emit event for optimistic updates
      emitDataChange(entity, 'save', result)

      return result
    } catch (error) {
      console.error(`Failed to save ${entity}:`, error)
      throw error
    }
  }

  async function remove(entity, id) {
    try {
      const result = await ws.api.delete[entity]({ id })

      // Invalidate related cache entries
      invalidateCache(entity)

      // Emit event for optimistic updates
      emitDataChange(entity, 'delete', { id })

      return result
    } catch (error) {
      console.error(`Failed to delete ${entity}:`, error)
      throw error
    }
  }

  function waitForLoading(key) {
    return new Promise((resolve, reject) => {
      const checkLoading = () => {
        if (!loading.value.has(key)) {
          const cached = cache.value.get(key)
          const error = errors.value.get(key)
          if (error) {
            reject(error)
          } else {
            resolve(cached)
          }
        } else {
          setTimeout(checkLoading, 100)
        }
      }
      checkLoading()
    })
  }

  function invalidateCache(entity) {
    const keysToDelete = []

    for (const [key] of cache.value) {
      if (key.startsWith(`${entity}:`)) {
        keysToDelete.push(key)
      }
    }

    keysToDelete.forEach(key => {
      cache.value.delete(key)
      lastFetch.value.delete(key)
      errors.value.delete(key)
    })
  }

  function invalidateAll() {
    cache.value.clear()
    lastFetch.value.clear()
    errors.value.clear()
  }

  function getCached(entity, operation, params) {
    const key = generateCacheKey(entity, operation, params)
    return cache.value.get(key)
  }

  function isLoading(entity, operation = 'search', params = {}) {
    const key = generateCacheKey(entity, operation, params)
    return loading.value.has(key)
  }

  function getError(entity, operation = 'search', params = {}) {
    const key = generateCacheKey(entity, operation, params)
    return errors.value.get(key)
  }

  function clearError(entity, operation = 'search', params = {}) {
    const key = generateCacheKey(entity, operation, params)
    errors.value.delete(key)
  }

  function generateCacheKey(entity, operation, params) {
    // Sort params to ensure consistent keys
    const sortedParams = JSON.stringify(params, Object.keys(params).sort())
    return `${entity}:${operation}:${sortedParams}`
  }

  function isCacheExpired(key) {
    const fetchTime = lastFetch.value.get(key)
    if (!fetchTime) return true
    return Date.now() - fetchTime > CACHE_TTL
  }

  function emitDataChange(entity, operation, data) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('genux:data-change', {
        detail: { entity, operation, data }
      }))
    }
  }

  // Optimistic updates
  function optimisticUpdate(entity, id, updates) {
    // Update cached search results
    for (const [key, data] of cache.value) {
      if (key.startsWith(`${entity}:search:`)) {
        if (data.items && Array.isArray(data.items)) {
          const item = data.items.find(item => item.id === id)
          if (item) {
            Object.assign(item, updates)
          }
        }
      }

      // Update cached get results
      if (key.startsWith(`${entity}:get:`) && data.id === id) {
        Object.assign(data, updates)
      }
    }
  }

  function optimisticAdd(entity, item) {
    // Add to cached search results
    for (const [key, data] of cache.value) {
      if (key.startsWith(`${entity}:search:`)) {
        if (data.items && Array.isArray(data.items)) {
          data.items.unshift(item)
          if (data.total !== undefined) {
            data.total++
          }
        }
      }
    }
  }

  function optimisticRemove(entity, id) {
    // Remove from cached results
    for (const [key, data] of cache.value) {
      if (key.startsWith(`${entity}:search:`)) {
        if (data.items && Array.isArray(data.items)) {
          const index = data.items.findIndex(item => item.id === id)
          if (index > -1) {
            data.items.splice(index, 1)
            if (data.total !== undefined) {
              data.total--
            }
          }
        }
      }

      // Remove cached get results
      if (key.startsWith(`${entity}:get:`) && data.id === id) {
        cache.value.delete(key)
        lastFetch.value.delete(key)
      }
    }
  }

  // Prefetch data for better UX
  async function prefetch(entity, operation = 'search', params = {}) {
    const key = generateCacheKey(entity, operation, params)

    // Don't prefetch if already cached and not expired
    if (cache.value.has(key) && !isCacheExpired(key)) {
      return
    }

    // Don't prefetch if already loading
    if (loading.value.has(key)) {
      return
    }

    try {
      await fetch(entity, operation, params)
    } catch (error) {
      // Ignore prefetch errors
      console.warn(`Prefetch failed for ${entity}:`, error)
    }
  }

  // Get cache statistics
  function getCacheStats() {
    const stats = {
      totalEntries: cache.value.size,
      loadingOperations: loading.value.size,
      errorCount: errors.value.size,
      cacheByEntity: {}
    }

    for (const [key] of cache.value) {
      const [entity] = key.split(':')
      stats.cacheByEntity[entity] = (stats.cacheByEntity[entity] || 0) + 1
    }

    return stats
  }

  // Listen for broadcasts to invalidate cache
  if (typeof window !== 'undefined') {
    window.addEventListener('dzql:broadcast', (event) => {
      const { entity, operation } = event.detail
      if (entity && ['save', 'delete', 'create', 'update'].includes(operation)) {
        invalidateCache(entity)
      }
    })
  }

  return {
    // State
    cache,
    loading,
    errors,
    lastFetch,

    // Computed
    isConnected,

    // Actions
    fetch,
    save,
    remove,
    invalidateCache,
    invalidateAll,
    getCached,
    isLoading,

    getError,
    clearError,
    optimisticUpdate,
    optimisticAdd,
    optimisticRemove,
    prefetch,
    getCacheStats
  }
})
