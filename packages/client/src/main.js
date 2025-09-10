import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { createPinia } from 'pinia'
import { useProfileStore } from './stores/main'
import { uiConfig } from './stores/ui-config.js'
import './style.css'
import App from './App.vue'
import Home from './components/hello.vue'
import DynamicEntity from './components/DynamicEntity.vue'

// Initialize WebSocket connection
const pinia = createPinia()

// Configure router
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Home },
    {
      path: '/:entity',
      component: DynamicEntity,
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
