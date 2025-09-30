<template>
  <div class="genux-app">
    <!-- Global Map Overlay -->
    <Teleport to="body">
      <GlobalMap
        v-if="showGlobalMap"
        @close="showGlobalMap = false"
        @navigate="handleMapNavigation"
      />
    </Teleport>

    <!-- Main Layout -->
    <div class="app-layout" :class="{ 'map-open': showGlobalMap }">
      <!-- Header -->
      <header class="app-header">
        <div class="header-left">
          <button
            @click="toggleSidebar"
            class="btn-icon sidebar-toggle"
            :title="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <Breadcrumbs @navigate="handleBreadcrumbNavigation" />
        </div>

        <div class="header-center">
          <div class="current-entity-label" v-if="currentEntity">
            {{ formatEntityName(currentEntity) }}
          </div>
        </div>

        <div class="header-right">
          <button
            @click="showGlobalMap = true"
            class="btn-icon"
            title="Show navigation map"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v6m0 6v6m-9-9h6m6 0h6" />
            </svg>
          </button>

          <button
            @click="showSearch = true"
            class="btn-icon"
            title="Search"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </button>

          <UserMenu />
        </div>
      </header>

      <!-- Sidebar -->
      <aside class="app-sidebar" :class="{ collapsed: sidebarCollapsed }">
        <nav class="sidebar-nav">
          <div class="nav-section">
            <h3 class="nav-title">Quick Access</h3>
            <button
              v-for="entity in quickAccessEntities"
              :key="entity.table_name"
              @click="navigateToEntity(entity.table_name)"
              class="nav-item"
              :class="{ active: currentEntity === entity.table_name }"
            >
              <span class="nav-icon">{{ getEntityIcon(entity.table_name) }}</span>
              <span class="nav-label">{{ formatEntityName(entity.table_name) }}</span>
            </button>
          </div>

          <div class="nav-section" v-if="recentPaths.length > 0">
            <h3 class="nav-title">Recent</h3>
            <button
              v-for="path in recentPaths"
              :key="path"
              @click="navigateToPath(path)"
              class="nav-item nav-recent"
            >
              <span class="nav-label">{{ formatPathLabel(path) }}</span>
            </button>
          </div>
        </nav>
      </aside>

      <!-- Main Content Area -->
      <main class="app-main">
        <NodeContainer v-if="currentEntity" />
        <Welcome v-else @start="handleWelcomeAction" />
      </main>

      <!-- Search Modal -->
      <Teleport to="body">
        <SearchModal
          v-if="showSearch"
          @close="showSearch = false"
          @navigate="handleSearchNavigation"
        />
      </Teleport>
    </div>

    <!-- Loading Overlay -->
    <LoadingOverlay v-if="initializing" message="Loading metadata..." />

    <!-- Error Toast Container -->
    <ToastContainer />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, onUnmounted } from 'vue'
import { useNavigationStore } from '@stores/navigation'
import { useMetadataStore } from '@stores/metadata'
import { useWebSocketStore } from '@stores/websocket'
import { useDataStore } from '@stores/data'

// Components
import GlobalMap from '@components/GlobalMap.vue'
import Breadcrumbs from '@components/Breadcrumbs.vue'
import UserMenu from '@components/UserMenu.vue'
import NodeContainer from '@components/NodeContainer.vue'
import Welcome from '@components/Welcome.vue'
import SearchModal from '@components/SearchModal.vue'
import LoadingOverlay from '@components/LoadingOverlay.vue'
import ToastContainer from '@components/ToastContainer.vue'

// Stores
const navigation = useNavigationStore()
const metadata = useMetadataStore()
const ws = useWebSocketStore()
const data = useDataStore()

// State
const showGlobalMap = ref(false)
const showSearch = ref(false)
const sidebarCollapsed = ref(false)
const initializing = ref(true)
const recentPaths = ref([])

// Computed
const currentEntity = computed(() => navigation.currentEntity)

const quickAccessEntities = computed(() => {
  // Filter entities for quick access based on common usage
  const priorityEntities = ['organisations', 'venues', 'packages', 'users']
  return metadata.entities
    .filter(e => priorityEntities.includes(e.table_name))
    .sort((a, b) => {
      const aIndex = priorityEntities.indexOf(a.table_name)
      const bIndex = priorityEntities.indexOf(b.table_name)
      return aIndex - bIndex
    })
})

// Methods
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

function formatPathLabel(path) {
  const node = metadata.navigationGraph[path]
  if (!node) return path
  return node.breadcrumb.join(' → ')
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem('genux.sidebarCollapsed', sidebarCollapsed.value)
}

async function navigateToEntity(entityName) {
  // Find the root path for this entity
  const rootPath = `${entityName}.id`
  navigation.navigate(rootPath)
}

function navigateToPath(path) {
  navigation.navigate(path)
  addToRecentPaths(path)
}

function handleMapNavigation(path) {
  navigateToPath(path)
  showGlobalMap.value = false
}

function handleBreadcrumbNavigation(index) {
  const breadcrumbs = navigation.breadcrumbs
  if (index < breadcrumbs.length - 1) {
    // Navigate back to that point in the breadcrumb
    const targetEntity = breadcrumbs[index]
    navigation.navigate(`${targetEntity}.id`)
  }
}

function handleSearchNavigation(result) {
  navigateToPath(result.path)
  showSearch.value = false
}

function handleWelcomeAction(action) {
  if (action === 'explore') {
    showGlobalMap.value = true
  } else if (action.entity) {
    navigateToEntity(action.entity)
  }
}

function addToRecentPaths(path) {
  // Keep only unique paths, most recent first
  recentPaths.value = [
    path,
    ...recentPaths.value.filter(p => p !== path)
  ].slice(0, 5)

  // Save to localStorage
  localStorage.setItem('genux.recentPaths', JSON.stringify(recentPaths.value))
}

// Watch for navigation changes
watch(() => navigation.currentPath, (newPath) => {
  if (newPath) {
    addToRecentPaths(newPath)
  }
})

// Listen for WebSocket broadcasts
function handleBroadcast(event) {
  const { entity, operation, params } = event.detail

  // If we're currently viewing this entity, refresh the data
  if (entity === currentEntity.value) {
    data.invalidateCache(entity)
  }

  // Show toast notification for important operations
  if (operation === 'create' || operation === 'delete') {
    showToast({
      type: 'info',
      message: `${formatEntityName(entity)} ${operation}d`,
      duration: 3000
    })
  }
}

// Show toast notification (would be implemented in ToastContainer)
function showToast(options) {
  window.dispatchEvent(new CustomEvent('genux:toast', { detail: options }))
}

// Lifecycle
onMounted(async () => {
  try {
    // Load metadata
    await metadata.loadMetadata()

    // Connect WebSocket
    await ws.connect()

    // Restore sidebar state
    const savedCollapsed = localStorage.getItem('genux.sidebarCollapsed')
    if (savedCollapsed !== null) {
      sidebarCollapsed.value = savedCollapsed === 'true'
    }

    // Restore recent paths
    const savedRecent = localStorage.getItem('genux.recentPaths')
    if (savedRecent) {
      try {
        recentPaths.value = JSON.parse(savedRecent)
      } catch (e) {
        console.error('Failed to parse recent paths:', e)
      }
    }

    // Listen for broadcasts
    window.addEventListener('dzql:broadcast', handleBroadcast)

    // Check for initial navigation from URL
    const urlParams = new URLSearchParams(window.location.search)
    const initialPath = urlParams.get('path')
    if (initialPath) {
      navigation.navigate(initialPath)
    }

    initializing.value = false
  } catch (error) {
    console.error('Failed to initialize app:', error)
    showToast({
      type: 'error',
      message: 'Failed to initialize application',
      duration: 0 // Don't auto-dismiss errors
    })
    initializing.value = false
  }
})

onUnmounted(() => {
  window.removeEventListener('dzql:broadcast', handleBroadcast)
})
</script>

<style scoped>
.genux-app {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: var(--color-background);
  color: var(--color-text);
}

.app-layout {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  grid-template-rows: var(--header-height) 1fr;
  width: 100%;
  height: 100%;
  transition: filter 0.3s ease;
}

.app-layout.map-open {
  filter: blur(2px);
}

/* Header */
.app-header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1rem;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  z-index: 100;
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-center {
  flex: 1;
  text-align: center;
}

.current-entity-label {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-primary);
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2.5rem;
  height: 2.5rem;
  border: none;
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-icon:hover {
  background: var(--color-hover);
  color: var(--color-text);
}

/* Sidebar */
.app-sidebar {
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
  transition: width 0.3s ease;
}

.app-sidebar.collapsed {
  width: var(--sidebar-width-collapsed);
}

.app-sidebar.collapsed .nav-label,
.app-sidebar.collapsed .nav-title {
  display: none;
}

.sidebar-nav {
  padding: 1rem;
}

.nav-section {
  margin-bottom: 2rem;
}

.nav-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  margin-bottom: 0.5rem;
  padding: 0 0.5rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.625rem 0.75rem;
  border: none;
  background: transparent;
  color: var(--color-text);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.nav-item:hover {
  background: var(--color-hover);
}

.nav-item.active {
  background: var(--color-primary-alpha);
  color: var(--color-primary);
}

.nav-icon {
  font-size: 1.25rem;
  width: 1.5rem;
  text-align: center;
}

.nav-label {
  flex: 1;
  font-size: 0.875rem;
}

.nav-recent .nav-label {
  font-size: 0.8125rem;
  color: var(--color-text-secondary);
}

/* Main Content */
.app-main {
  grid-column: 2;
  overflow: hidden;
  background: var(--color-background);
}

/* Responsive */
@media (max-width: 768px) {
  .app-layout {
    grid-template-columns: 0 1fr;
  }

  .app-sidebar {
    position: fixed;
    left: 0;
    top: var(--header-height);
    bottom: 0;
    width: var(--sidebar-width);
    transform: translateX(-100%);
    z-index: 200;
  }

  .app-sidebar:not(.collapsed) {
    transform: translateX(0);
    box-shadow: 2px 0 8px rgba(0, 0, 0, 0.1);
  }

  .header-center {
    display: none;
  }
}
</style>
