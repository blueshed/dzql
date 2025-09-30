import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useWs } from 'dzql/client'

export const useWebSocketStore = defineStore('websocket', () => {
  // Use existing WebSocket singleton
  const ws = useWs()

  // State
  const user = ref(null)
  const meta = ref(null)
  const connecting = ref(false)
  const error = ref(null)

  // Computed
  const connected = computed(() => ws.isConnected())
  const api = computed(() => ws.api)

  // Set up broadcast handler
  ws.onBroadcast(async (method, params) => {
    // Handle connection status updates
    if (method === "connected") {
      user.value = params.profile || params.user || null
      console.log('User connected:', user.value)

      // Load metadata when connected
      try {
        meta.value = await ws.api.get_entities_metadata()
      } catch (error) {
        console.error('Failed to load metadata:', error)
      }
      return
    }

    // Handle entity broadcasts
    if (method && method.includes(':')) {
      const [entity, operation] = method.split(':')

      // Emit global events for components
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dzql:broadcast', {
          detail: { entity, operation, params, method }
        }))
      }
    }
  })

  // Actions
  async function connect() {
    if (connecting.value || connected.value) {
      return
    }

    connecting.value = true
    error.value = null

    try {
      const wsUrl = import.meta.env.DEV ? 'ws://localhost:3000/ws' : null
      await ws.connect(wsUrl)
    } catch (e) {
      error.value = e
      console.error('WebSocket connection failed:', e)
      throw e
    } finally {
      connecting.value = false
    }
  }

  async function login(email, password) {
    if (!connected.value) {
      throw new Error('WebSocket not connected')
    }

    try {
      const result = await ws.call('login_user', { email, password })
      user.value = result.user || result

      // Store token if provided
      if (result.token && typeof localStorage !== 'undefined') {
        localStorage.setItem('dzql_token', result.token)
      }

      return result
    } catch (error) {
      console.error('Login failed:', error)
      throw error
    }
  }

  async function logout() {
    if (!connected.value || !user.value) {
      return
    }

    try {
      await ws.call('logout_user', {})
    } catch (error) {
      console.warn('Logout call failed:', error)
    }

    user.value = null

    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('dzql_token')
    }
  }

  function disconnect() {
    ws.disconnect()
    user.value = null
    meta.value = null
  }

  // Call method directly
  function call(method, params) {
    return ws.call(method, params)
  }

  return {
    // State
    user,
    meta,
    connecting,
    error,

    // Computed
    connected,
    api,

    // Actions
    connect,
    login,
    logout,
    disconnect,
    call
  }
})
