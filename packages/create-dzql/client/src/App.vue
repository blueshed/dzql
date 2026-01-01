<script setup lang="ts">
import { useDzql } from '@/composables/useDzql'
import LoginView from '@/components/LoginView.vue'

const { ready, user, logout } = useDzql()
</script>

<template>
  <!-- Phase 1: Connecting -->
  <div v-if="!ready" class="min-h-screen flex items-center justify-center bg-gray-100">
    <div class="text-center">
      <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
      <p class="mt-4 text-gray-600">Connecting...</p>
    </div>
  </div>

  <!-- Phase 2: Login -->
  <LoginView v-else-if="!user" />

  <!-- Phase 3: Ready -->
  <div v-else class="min-h-screen bg-gray-100">
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <h1 class="text-xl font-bold text-gray-900">
          <router-link to="/">DZQL App</router-link>
        </h1>
        <div class="flex items-center gap-4">
          <span class="text-gray-600">{{ user.name || user.email }}</span>
          <button
            @click="logout"
            class="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
    <main class="max-w-7xl mx-auto px-4 py-8">
      <router-view />
    </main>
  </div>
</template>
