import { createRouter, createWebHashHistory } from 'vue-router'
import PostList from '@/components/PostList.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: PostList
    }
  ]
})

export default router
