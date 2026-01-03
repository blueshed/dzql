<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDzql } from '@/composables/useDzql'

const route = useRoute()
const router = useRouter()
const { ws, user } = useDzql()

const postId = computed(() => route.params.id ? Number(route.params.id) : null)
const isEditing = computed(() => postId.value !== null)

const title = ref('')
const content = ref('')
const loading = ref(false)
const error = ref('')

onMounted(async () => {
  if (isEditing.value) {
    loading.value = true
    try {
      const result = await ws.api.get_posts({ id: postId.value }) as any
      const post = Array.isArray(result) ? result[0] : result
      if (!post) {
        error.value = 'Post not found'
        return
      }
      if (post.author_id !== user.value?.id) {
        error.value = 'You can only edit your own posts'
        return
      }
      title.value = post.title
      content.value = post.content || ''
    } catch (e: any) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }
})

async function savePost() {
  if (!title.value.trim()) return

  loading.value = true
  error.value = ''

  try {
    const params: any = {
      title: title.value,
      content: content.value,
      published: true
    }
    if (isEditing.value) {
      params.id = postId.value
    }
    await ws.api.save_posts(params)
    router.push('/')
  } catch (e: any) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="max-w-2xl mx-auto">
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-2xl font-bold">{{ isEditing ? 'Edit Post' : 'New Post' }}</h2>
      <button
        @click="router.push('/')"
        class="text-gray-600 hover:text-gray-800"
      >
        Cancel
      </button>
    </div>

    <div v-if="error" class="bg-red-100 text-red-700 p-4 rounded-lg mb-6">
      {{ error }}
    </div>

    <div v-if="loading && isEditing" class="text-center py-8 text-gray-500">
      Loading post...
    </div>

    <form v-else @submit.prevent="savePost" class="bg-white p-6 rounded-lg shadow space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Title</label>
        <input
          v-model="title"
          type="text"
          required
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Post title"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">Content</label>
        <textarea
          v-model="content"
          rows="6"
          class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Write your post..."
        ></textarea>
      </div>
      <button
        type="submit"
        :disabled="loading"
        class="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-md"
      >
        {{ loading ? 'Saving...' : (isEditing ? 'Save Changes' : 'Publish') }}
      </button>
    </form>
  </div>
</template>
