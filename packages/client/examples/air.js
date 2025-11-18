import { createApp } from 'vue'
import { createPinia } from 'pinia'
import AirTableView from '../src/components/AirTableView.vue'
import '../src/style.css'

const pinia = createPinia()
const app = createApp(AirTableView)

app.use(pinia)
app.mount('#app')
