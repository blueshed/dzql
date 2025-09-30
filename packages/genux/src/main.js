import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

// Global styles
import './styles/variables.css'
import './styles/layout.css'
import './styles/surfaces.css'

// Create Vue app
const app = createApp(App)

// Create Pinia instance
const pinia = createPinia()

// Use Pinia
app.use(pinia)

// Global error handler
app.config.errorHandler = (err, instance, info) => {
  console.error('Global error:', err)
  console.error('Component:', instance)
  console.error('Error info:', info)
}

// Mount app
app.mount('#app')
