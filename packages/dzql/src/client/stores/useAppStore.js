/**
 * Canonical DZQL App Pinia Store
 *
 * Manages application-level state including:
 * - App initialization
 * - Router integration
 * - Global UI state
 * - Entity metadata caching
 *
 * Works with useWsStore to provide complete app lifecycle management.
 *
 * @example
 * // In main.js
 * import { createApp } from 'vue'
 * import { createPinia } from 'pinia'
 * import { useAppStore } from 'dzql/client/stores'
 * import App from './App.vue'
 *
 * const pinia = createPinia()
 * const app = createApp(App)
 * app.use(pinia)
 *
 * const appStore = useAppStore()
 * await appStore.initialize()
 *
 * app.mount('#app')
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWsStore } from './useWsStore.js'

export const useAppStore = defineStore('dzql-app', () => {
  // ===== State =====

  /**
   * App title
   */
  const title = ref('DZQL App')

  /**
   * Current route/entity context
   */
  const currentEntity = ref(null)
  const currentId = ref(null)

  /**
   * Entity metadata cache
   * Maps entity name -> metadata object
   */
  const entityMetadata = ref({})

  /**
   * Loading states
   */
  const isLoadingMetadata = ref(false)

  /**
   * UI state
   */
  const sidebarOpen = ref(true)
  const propertiesPanelOpen = ref(true)

  /**
   * Router instance (set via setRouter)
   */
  let routerInstance = null

  // ===== Computed =====

  const hasMetadata = computed(() => Object.keys(entityMetadata.value).length > 0)

  const entityList = computed(() => {
    return Object.keys(entityMetadata.value).sort()
  })

  const currentEntityMeta = computed(() => {
    if (!currentEntity.value) return null
    return entityMetadata.value[currentEntity.value] || null
  })

  // ===== Actions =====

  /**
   * Initialize the app
   *
   * Connects to WebSocket and sets up app lifecycle.
   *
   * @param {Object} options
   * @param {string} [options.wsUrl] - WebSocket URL (auto-detected if not provided)
   * @param {string} [options.title] - App title
   * @returns {Promise<void>}
   *
   * @example
   * await appStore.initialize()
   *
   * @example
   * await appStore.initialize({
   *   wsUrl: 'ws://localhost:3000/ws',
   *   title: 'My DZQL App'
   * })
   */
  async function initialize(options = {}) {
    const wsStore = useWsStore()

    // Set app title if provided
    if (options.title) {
      title.value = options.title
    }

    // Connect to WebSocket
    await wsStore.connect(options.wsUrl)

    // If authenticated, fetch metadata
    if (wsStore.isAuthenticated) {
      await fetchMetadata()
    }

    console.log('[AppStore] Initialized')
  }

  /**
   * Fetch entity metadata from server
   *
   * Called automatically after authentication.
   *
   * @returns {Promise<void>}
   */
  async function fetchMetadata() {
    const wsStore = useWsStore()
    const ws = wsStore.getWs()

    if (!wsStore.isConnected) {
      console.warn('[AppStore] Cannot fetch metadata: not connected')
      return
    }

    try {
      isLoadingMetadata.value = true

      // Call the meta endpoint
      const result = await ws.call('meta')

      if (result && result.entities) {
        entityMetadata.value = result.entities
        console.log('[AppStore] Metadata loaded:', Object.keys(result.entities))
      }

    } catch (err) {
      console.error('[AppStore] Failed to fetch metadata:', err)
    } finally {
      isLoadingMetadata.value = false
    }
  }

  /**
   * Set the router instance
   *
   * Call this in main.js after creating the router to enable
   * programmatic navigation from the store.
   *
   * @param {Router} router - Vue Router instance
   *
   * @example
   * import { createRouter } from 'vue-router'
   * import { useAppStore } from 'dzql/client/stores'
   *
   * const router = createRouter({ ... })
   * const appStore = useAppStore()
   * appStore.setRouter(router)
   */
  function setRouter(router) {
    routerInstance = router

    // Watch route changes to update current context
    if (router) {
      router.afterEach((to) => {
        currentEntity.value = to.params.entity || null
        currentId.value = to.params.id || null
      })
    }
  }

  /**
   * Navigate to entity list
   *
   * @param {string} entity - Entity name
   *
   * @example
   * appStore.navigateToEntity('venues')
   */
  function navigateToEntity(entity) {
    if (routerInstance) {
      routerInstance.push({ name: 'entity-list', params: { entity } })
    }
    currentEntity.value = entity
    currentId.value = null
  }

  /**
   * Navigate to entity detail/edit
   *
   * @param {string} entity - Entity name
   * @param {number|string} id - Record ID or 'new'
   *
   * @example
   * appStore.navigateToEntityDetail('venues', 123)
   * appStore.navigateToEntityDetail('venues', 'new')
   */
  function navigateToEntityDetail(entity, id) {
    if (routerInstance) {
      const routeName = id === 'new' ? 'entity-create' : 'entity-edit'
      routerInstance.push({ name: routeName, params: { entity, id } })
    }
    currentEntity.value = entity
    currentId.value = id
  }

  /**
   * Navigate to home
   *
   * @example
   * appStore.navigateToHome()
   */
  function navigateToHome() {
    if (routerInstance) {
      routerInstance.push({ name: 'home' })
    }
    currentEntity.value = null
    currentId.value = null
  }

  /**
   * Toggle sidebar
   */
  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value
  }

  /**
   * Toggle properties panel
   */
  function togglePropertiesPanel() {
    propertiesPanelOpen.value = !propertiesPanelOpen.value
  }

  /**
   * Set current context (useful for manual navigation)
   *
   * @param {string|null} entity - Entity name
   * @param {number|string|null} id - Record ID
   */
  function setContext(entity, id = null) {
    currentEntity.value = entity
    currentId.value = id
  }

  // ===== Return Public API =====

  return {
    // State
    title,
    currentEntity,
    currentId,
    entityMetadata,
    isLoadingMetadata,
    sidebarOpen,
    propertiesPanelOpen,

    // Computed
    hasMetadata,
    entityList,
    currentEntityMeta,

    // Actions
    initialize,
    fetchMetadata,
    setRouter,
    navigateToEntity,
    navigateToEntityDetail,
    navigateToHome,
    toggleSidebar,
    togglePropertiesPanel,
    setContext
  }
})
