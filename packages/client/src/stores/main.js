import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWs } from "dzql/client";
import { uiConfig } from './ui-config.js';

export const useProfileStore = defineStore('profile', () => {

  const ws = useWs();
  const profile = ref(null)
  const meta = ref(null)

  ws.onBroadcast(async (method, params) => {
    // Handle connection status updates
    if (method === "connected") {
      profile.value = params.profile || null;
      console.log(`Connected`, profile.value);
      meta.value = await ws.api.get_entities_metadata()
      return;
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
