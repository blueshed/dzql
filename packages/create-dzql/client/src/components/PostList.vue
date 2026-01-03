<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { usePostsFeedStore } from '@generated/client/stores/usePostsFeedStore'
import { useDzql } from '@/composables/useDzql'

const { ws } = useDzql()
const store = usePostsFeedStore()

// Bind to the store - it handles all patching internally
const doc = ref<any>(null)
const loading = ref(true)
const error = ref('')

// Computed posts from store document
const posts = computed(() => doc.value?.data?.posts || [])

const newPostTitle = ref('')
const newPostContent = ref('')
const showForm = ref(false)

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

onUnmounted(() => {
  store.unbind({})
})

async function createPost() {
  if (!newPostTitle.value.trim()) return

  try {
    await ws.api.save_posts({
      title: newPostTitle.value,
      content: newPostContent.value,
      published: true
    } as any)
    newPostTitle.value = ''
    newPostContent.value = ''
    showForm.value = false
  } catch (e: any) {
    error.value = e.message
  }
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
        @click="showForm = !showForm"
        class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md"
      >
        {{ showForm ? 'Cancel' : 'New Post' }}
      </button>
    </div>

    <!-- New Post Form -->
    <div v-if="showForm" class="bg-white p-6 rounded-lg shadow mb-6">
      <h3 class="text-lg font-medium mb-4">Create New Post</h3>
      <form @submit.prevent="createPost" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input
            v-model="newPostTitle"
            type="text"
            required
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Post title"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Content</label>
          <textarea
            v-model="newPostContent"
            rows="4"
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Write your post..."
          ></textarea>
        </div>
        <button
          type="submit"
          class="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md"
        >
          Publish
        </button>
      </form>
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
          <button
            @click="deletePost(post.id)"
            class="text-red-600 hover:text-red-800 text-sm"
          >
            Delete
          </button>
        </div>
        <p v-if="post.content" class="mt-4 text-gray-700">
          {{ post.content }}
        </p>
      </article>
    </div>
  </div>
</template>
