<template>
  <div class="min-h-screen bg-base-200">
    <!-- Connecting State -->
    <div v-if="state === 'connecting'" class="hero min-h-screen">
      <div class="hero-content text-center">
        <div>
          <span class="loading loading-spinner loading-lg text-primary"></span>
          <p class="mt-4 text-base-content">Connecting to server...</p>
        </div>
      </div>
    </div>

    <!-- Login State -->
    <LoginView v-else-if="state === 'login'" @authenticated="handleAuth" />

    <!-- Content State (ready) -->
    <router-view v-else-if="state === 'ready'" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useWsStore } from 'dzql/client/stores'
import { useMetaStore } from '../stores/meta'
import LoginView from './LoginView.vue'

const wsStore = useWsStore()
const metaStore = useMetaStore()

const state = computed(() => wsStore.appState)

const handleAuth = async (profile) => {
  // Profile is already set by wsStore.login()
  // Fetch metadata  await metaStore.fetchMetadata()
}
</script>
