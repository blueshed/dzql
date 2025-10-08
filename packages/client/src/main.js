import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { createPinia } from 'pinia'
import { useProfileStore } from './stores/main'
import './style.css'
import App from './App.vue'

// Initialize WebSocket connection
const pinia = createPinia()

// Simple container component for routing (Vue Router requires component)
const RouteContainer = {
  template: '<div />'
}

// Configure router
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: RouteContainer
    },
    {
      path: '/:entity',
      name: 'entity-list',
      component: RouteContainer,
      props: true
    },
    {
      path: '/:entity/new',
      name: 'entity-create',
      component: RouteContainer,
      props: true
    },
    {
      path: '/:entity/:id',
      name: 'entity-edit',
      component: RouteContainer,
      props: true
    }
  ]
})

// Global navigation guard to close any open dropdowns/menus
router.beforeEach((to, from, next) => {
  // Click on body to close any open Headless UI menus
  document.body.click()
  next()
})

// Create and mount app
const app = createApp(App)
app.use(router)
app.use(pinia)


const store = useProfileStore()
store.connect()


app.mount('#app')
