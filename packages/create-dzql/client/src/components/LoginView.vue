<script setup lang="ts">
import { ref } from 'vue'
import { useTzql } from '@/composables/useTzql'

const { login, register } = useTzql()

const isRegistering = ref(false)
const name = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function handleSubmit() {
  error.value = ''
  loading.value = true

  try {
    if (isRegistering.value) {
      await register(name.value, email.value, password.value)
    } else {
      await login(email.value, password.value)
    }
  } catch (e: any) {
    error.value = e.message || 'Authentication failed'
  } finally {
    loading.value = false
  }
}

function toggleMode() {
  isRegistering.value = !isRegistering.value
  error.value = ''
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-100">
    <div class="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
      <h2 class="text-2xl font-bold text-center mb-6">
        {{ isRegistering ? 'Create Account' : 'Sign In' }}
      </h2>

      <form @submit.prevent="handleSubmit" class="space-y-4">
        <div v-if="isRegistering">
          <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            v-model="name"
            type="text"
            required
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Your name"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            v-model="email"
            type="email"
            required
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
          <input
            v-model="password"
            type="password"
            required
            class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="********"
          />
        </div>

        <div v-if="error" class="text-red-600 text-sm">
          {{ error }}
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium rounded-md transition-colors"
        >
          {{ loading ? 'Please wait...' : (isRegistering ? 'Create Account' : 'Sign In') }}
        </button>
      </form>

      <p class="mt-4 text-center text-sm text-gray-600">
        {{ isRegistering ? 'Already have an account?' : "Don't have an account?" }}
        <button
          @click="toggleMode"
          class="text-blue-600 hover:text-blue-800 font-medium ml-1"
        >
          {{ isRegistering ? 'Sign in' : 'Create one' }}
        </button>
      </p>
    </div>
  </div>
</template>
