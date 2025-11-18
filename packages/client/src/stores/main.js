/**
 * Legacy Profile Store - Adapter to Canonical useWsStore
 *
 * This store provides backward compatibility for existing components
 * while using the canonical useWsStore internally.
 */
import { defineStore } from 'pinia'
import { computed, watch } from 'vue'
import { useWsStore } from 'dzql/client/stores'
import { useMetaStore } from './meta.js'
import { uiConfig } from './ui-config.js'

export const useProfileStore = defineStore('profile', () => {
  // Use canonical store
  const wsStore = useWsStore()

  // Expose profile as computed from canonical store
  const profile = computed(() => wsStore.profile)

  // Watch for profile changes and fetch metadata when user logs in
  watch(profile, async (value) => {
    if (value) {
      // Fetch metadata via MetaStore when user logs in
      const metaStore = useMetaStore()
      await metaStore.fetchMetadata()
    }
  })

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
