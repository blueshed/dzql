import './style.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router/index'
import { useDzql } from './composables/useDzql'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

// Connect to DZQL server
const { connect } = useDzql()
connect()
