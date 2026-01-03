import { createRouter, createWebHashHistory } from 'vue-router'
import PostList from '@/components/PostList.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: PostList
    },
    {
      path: '/posts/new',
      name: 'newPost',
      component: () => import('@/components/PostForm.vue')
    },
    {
      path: '/posts/:id/edit',
      name: 'editPost',
      component: () => import('@/components/PostForm.vue')
    }
  ]
})

export default router
