import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { useProfileStore } from '../src/stores/main'
import AirTableView from '../src/components/AirTableView.vue'
import '../src/style.css'

const pinia = createPinia()
const app = createApp(AirTableView)

app.use(pinia)

const store = useProfileStore()
store.connect()

app.mount('#app')
