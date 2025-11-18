/**
 * DZQL Admin - Zero Configuration Admin Interface
 *
 * Creates a complete admin interface from DZQL metadata alone.
 * No configuration required. Just pass a WebSocket connection.
 *
 * @example
 * ```js
 * import { createDZQLAdmin } from 'dzql/admin'
 *
 * const app = createDZQLAdmin('ws://localhost:3000/ws')
 * app.mount('#app')
 * ```
 *
 * @example with options
 * ```js
 * const app = createDZQLAdmin('ws://localhost:3000/ws', {
 *   theme: 'dark',
 *   title: 'My Admin',
 *   entities: {
 *     venues: {
 *       icon: 'building',
 *       list: { columns: ['name', 'city'] }
 *     }
 *   }
 * })
 * ```
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import { useProfileStore } from './stores/main.js'
import App from './App.vue'

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  theme: 'light',
  title: 'DZQL Admin',
  entities: {},
  router: {
    base: '/'
  }
}

/**
 * Create a DZQL Admin application
 *
 * @param {string|object} wsUrlOrConnection - WebSocket URL or connection instance
 * @param {object} options - Optional configuration overrides
 * @returns {object} Vue application instance with mount() method
 */
export function createDZQLAdmin(wsUrlOrConnection, options = {}) {
  // Merge user config with defaults
  const config = {
    ...DEFAULT_CONFIG,
    ...options,
    entities: {
      ...DEFAULT_CONFIG.entities,
      ...(options.entities || {})
    }
  }

  // Create Vue app
  const app = createApp(App, {
    wsUrl: typeof wsUrlOrConnection === 'string' ? wsUrlOrConnection : null,
    wsConnection: typeof wsUrlOrConnection === 'object' ? wsUrlOrConnection : null,
    config
  })

  // Install Pinia for state management
  const pinia = createPinia()
  app.use(pinia)

  // Create router with dynamic routes
  // Use hash history to avoid conflicts with static file paths (like /examples/)
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      {
        path: '/',
        name: 'home',
        component: () => import('./components/hello.vue')
      },
      {
        path: '/:entity',
        name: 'entity-list',
        component: App
      },
      {
        path: '/:entity/:id',
        name: 'entity-detail',
        component: App
      }
    ]
  })

  app.use(router)

  // Provide config globally
  app.provide('dzqlConfig', config)

  // Convert relative paths to full WebSocket URLs for browser
  let wsUrl = typeof wsUrlOrConnection === 'string' ? wsUrlOrConnection : null
  if (wsUrl && typeof window !== 'undefined') {
    // If it's a relative path (starts with /), convert to full ws:// URL
    if (wsUrl.startsWith('/')) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      wsUrl = `${protocol}//${window.location.host}${wsUrl}`
    }
  }

  return {
    app,
    router,
    pinia,
    async mount(selector) {
      // Mount the app first so Pinia stores are available
      const result = app.mount(selector)

      // Initialize using legacy store pattern (like original main.js)
      const profileStore = useProfileStore()

      // Connect to WebSocket - this will trigger metadata fetch via watch
      try {
        await profileStore.connect(wsUrl)
      } catch (err) {
        console.error('[createDZQLAdmin] Failed to connect:', err)
      }

      return result
    }
  }
}

/**
 * Export default for convenience
 */
export default createDZQLAdmin
