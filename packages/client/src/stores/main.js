import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useWs } from "dzql/client";
import { uiConfig } from './ui-config.js';
import { useMetaStore } from './meta.js';

export const useProfileStore = defineStore('profile', () => {

  const ws = useWs();
  const profile = ref(null)

  ws.onBroadcast(async (method, params) => {
    // Handle connection status updates
    if (method === "connected") {
      profile.value = params.profile || null;
      console.log(`Connected`, profile.value);

      return;
    }
  })

  watch(()=> profile.value, async (value) => {
    if(value){
      // Fetch metadata via MetaStore when user logs in
      const metaStore = useMetaStore()
      await metaStore.fetchMetadata()
    }
  })

  const connect = async () => {
    await ws.connect(import.meta.env.DEV ? 'ws://localhost:3000/ws' : null)
  }

  return {
    profile,
    connect,
    uiConfig
  }
})
