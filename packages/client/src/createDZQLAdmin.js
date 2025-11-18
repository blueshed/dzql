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
import { createRouter, createWebHistory } from 'vue-router'
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
  const router = createRouter({
    history: createWebHistory(config.router.base),
    routes: [
      {
        path: '/',
        name: 'home',
        component: () => import('./components/HelloView.vue')
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

  return {
    app,
    router,
    pinia,
    mount(selector) {
      return app.mount(selector)
    }
  }
}

/**
 * Export default for convenience
 */
export default createDZQLAdmin
