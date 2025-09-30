import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useMetadataStore } from './metadata'

export const useNavigationStore = defineStore('navigation', () => {
  const metadataStore = useMetadataStore()

  // State
  const currentPath = ref(null)
  const history = ref([])
  const context = ref({})
  const selection = ref(new Set())

  // Getters
  const currentNode = computed(() =>
    currentPath.value ? metadataStore.getNavigationNode(currentPath.value) : null
  )

  const currentEntity = computed(() => currentNode.value?.current_entity || null)

  const breadcrumbs = computed(() => currentNode.value?.breadcrumb || [])

  const availableActions = computed(() => currentNode.value?.available_actions || [])

  const navigationOptions = computed(() => currentNode.value?.navigation_options || [])

  const uiHints = computed(() => currentNode.value?.ui_hints || {})

  const canGoBack = computed(() => history.value.length > 0)

  // Actions
  function navigate(path, carryContext = {}) {
    if (!path) {
      console.error('Cannot navigate to empty path')
      return
    }

    const node = metadataStore.getNavigationNode(path)
    if (!node) {
      console.error(`Invalid navigation path: ${path}`)
      return
    }

    // Save current path to history
    if (currentPath.value && currentPath.value !== path) {
      history.value.push({
        path: currentPath.value,
        context: { ...context.value },
        timestamp: Date.now()
      })

      // Keep history manageable (last 10 items)
      if (history.value.length > 10) {
        history.value.shift()
      }
    }

    // Set new path
    currentPath.value = path
    context.value = { ...context.value, ...carryContext }
    selection.value.clear()

    // Update URL without causing page refresh
    if (typeof window !== 'undefined') {
      const url = new URL(window.location)
      url.searchParams.set('path', path)
      window.history.pushState({ path }, '', url)
    }

    console.log(`Navigated to: ${path}`, { context: context.value })
  }

  function back() {
    if (history.value.length === 0) return

    const previous = history.value.pop()
    currentPath.value = previous.path
    context.value = previous.context || {}
    selection.value.clear()

    console.log(`Navigated back to: ${previous.path}`)
  }

  function setContext(key, value) {
    context.value[key] = value
  }

  function updateContext(updates) {
    context.value = { ...context.value, ...updates }
  }

  function clearContext() {
    context.value = {}
  }

  function setSelection(items) {
    selection.value.clear()
    if (Array.isArray(items)) {
      items.forEach(item => selection.value.add(item))
    } else if (items != null) {
      selection.value.add(items)
    }
  }

  function addToSelection(item) {
    selection.value.add(item)
  }

  function removeFromSelection(item) {
    selection.value.delete(item)
  }

  function toggleSelection(item) {
    if (selection.value.has(item)) {
      selection.value.delete(item)
    } else {
      selection.value.add(item)
    }
  }

  function clearSelection() {
    selection.value.clear()
  }

  function navigateToEntity(entityName, filters = {}) {
    const rootPath = `${entityName}.id`
    navigate(rootPath, { filters })
  }

  function navigateToRelation(relationPath, sourceId = null) {
    const contextUpdate = sourceId ? { sourceId } : {}
    navigate(relationPath, contextUpdate)
  }

  function buildBreadcrumbPath(index) {
    const crumbs = breadcrumbs.value
    if (index < 0 || index >= crumbs.length) return null

    // Build path by walking through breadcrumbs
    let path = crumbs[0]
    for (let i = 1; i <= index; i++) {
      const nextEntity = crumbs[i]
      // This is simplified - would need to resolve actual relationship paths
      path += `.id→${nextEntity}.id`
    }

    return path
  }

  function getAvailableNavigationOptions() {
    return navigationOptions.value.filter(option => {
      // Could add permission checking here
      return true
    })
  }

  // Initialize from URL on load
  function initializeFromUrl() {
    if (typeof window === 'undefined') return

    const urlParams = new URLSearchParams(window.location.search)
    const pathFromUrl = urlParams.get('path')

    if (pathFromUrl) {
      navigate(pathFromUrl)
    }
  }

  // Listen for browser back/forward
  function setupBrowserNavigation() {
    if (typeof window === 'undefined') return

    window.addEventListener('popstate', (event) => {
      if (event.state?.path) {
        currentPath.value = event.state.path
        // Don't add to history since this is browser navigation
      }
    })
  }

  return {
    // State
    currentPath,
    history,
    context,
    selection,

    // Getters
    currentNode,
    currentEntity,
    breadcrumbs,
    availableActions,
    navigationOptions,
    uiHints,
    canGoBack,

    // Actions
    navigate,
    back,
    setContext,
    updateContext,
    clearContext,
    setSelection,
    addToSelection,
    removeFromSelection,
    toggleSelection,
    clearSelection,
    navigateToEntity,
    navigateToRelation,
    buildBreadcrumbPath,
    getAvailableNavigationOptions,
    initializeFromUrl,
    setupBrowserNavigation
  }
})
