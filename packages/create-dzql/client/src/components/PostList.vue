<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePostsFeedStore } from '@generated/client/stores/usePostsFeedStore'
import { useDzql } from '@/composables/useDzql'

const router = useRouter()
const { ws, user } = useDzql()
const store = usePostsFeedStore()

const doc = ref<any>(null)
const loading = ref(true)
const error = ref('')

const posts = computed(() => doc.value?.data?.posts || [])

onMounted(async () => {
  try {
    const wrapper = await store.bind({})
    doc.value = wrapper
    loading.value = false
  } catch (e: any) {
    error.value = e.message
    loading.value = false
  }
})

function isAuthor(post: any) {
  return user.value?.id === post.author_id
}

async function deletePost(id: number) {
  if (!confirm('Delete this post?')) return

  try {
    await ws.api.delete_posts({ id })
  } catch (e: any) {
    error.value = e.message
  }
}
</script>

<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold">Posts</h2>
      <button
        @click="router.push('/posts/new')"
        class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
      >
        New Post
      </button>
    </div>

    <!-- Error -->
    <div v-if="error" class="bg-red-100 text-red-700 p-4 rounded-lg mb-6">
      {{ error }}
    </div>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-8 text-gray-500">
      Loading posts...
    </div>

    <!-- Posts List -->
    <div v-else-if="posts.length === 0" class="text-center py-8 text-gray-500">
      No posts yet. Create one!
    </div>

    <div v-else class="space-y-4">
      <article
        v-for="post in posts"
        :key="post.id"
        class="bg-white p-6 rounded-lg shadow"
      >
        <div class="flex justify-between items-start">
          <div>
            <h3 class="text-xl font-semibold">{{ post.title }}</h3>
            <p class="text-sm text-gray-500 mt-1">
              by {{ post.author?.name || 'Unknown' }}
              <span v-if="post.created_at">
                &middot; {{ new Date(post.created_at).toLocaleDateString() }}
              </span>
            </p>
          </div>
          <div v-if="isAuthor(post)" class="flex gap-3">
            <button
              @click="router.push(`/posts/${post.id}/edit`)"
              class="text-blue-600 hover:text-blue-800 text-sm"
            >
              Edit
            </button>
            <button
              @click="deletePost(post.id)"
              class="text-red-600 hover:text-red-800 text-sm"
            >
              Delete
            </button>
          </div>
        </div>
        <p v-if="post.content" class="mt-4 text-gray-700">
          {{ post.content }}
        </p>
      </article>
    </div>
  </div>
</template>
