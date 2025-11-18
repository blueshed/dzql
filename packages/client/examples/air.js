import { createApp } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import { createPinia } from 'pinia'
import { useProfileStore } from '../src/stores/main'
import AirApp from '../src/components/AirApp.vue'
import AirTableView from '../src/components/AirTableView.vue'
import '../src/style.css'

const pinia = createPinia()

// Configure router with hash-based routing
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: AirTableView
    },
    {
      path: '/:entity',
      name: 'entity',
      component: AirTableView,
      props: true
    },
    {
      path: '/:entity/:id',
      name: 'entity-record',
      component: AirTableView,
      props: true
    }
  ]
})

const app = createApp(AirApp)

app.use(pinia)
app.use(router)

const store = useProfileStore()
store.connect()

app.mount('#app')
