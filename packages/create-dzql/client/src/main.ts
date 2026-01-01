import './style.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useTzql } from './composables/useTzql'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Connect to DZQL server
const { connect } = useTzql()
connect()
