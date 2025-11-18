/**
 * Legacy Profile Store - Adapter to Canonical useWsStore
 *
 * This store provides backward compatibility for existing components
 * while using the canonical useWsStore internally.
 */
import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useWsStore } from 'dzql/client/stores'
import { uiConfig } from './ui-config.js'

export const useProfileStore = defineStore('profile', () => {
  // Use canonical store
  const wsStore = useWsStore()

  // Expose profile as computed from canonical store
  const profile = computed(() => wsStore.profile)

  // Proxy connect method
  const connect = async (url) => {
    await wsStore.connect(url)
  }

  return {
    profile,
    connect,
    uiConfig
  }
})
