/**
 * Canonical DZQL WebSocket Pinia Store
 *
 * Manages WebSocket connection with three-phase lifecycle:
 * 1. CONNECTING - Initial connection to server
 * 2. AUTHENTICATING - After connection, waiting for profile (login if needed)
 * 3. READY - Connected and authenticated, ready for use
 *
 * @example
 * // In your app
 * import { useWsStore } from 'dzql/client/stores'
 *
 * const wsStore = useWsStore()
 * await wsStore.connect() // or connect with custom URL
 *
 * // Access profile
 * console.log(wsStore.profile) // null if not authenticated
 *
 * // Login
 * await wsStore.login({ email: 'user@example.com', password: 'pass' })
 *
 * // Logout
 * await wsStore.logout()
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { WebSocketManager } from '../ws.js'

export const useWsStore = defineStore('dzql-ws', () => {
  // ===== State =====

  /**
   * Connection state: 'disconnected' | 'connecting' | 'connected' | 'error'
   */
  const connectionState = ref('disconnected')

  /**
   * App state: 'connecting' | 'login' | 'ready'
   * - connecting: Initial connection phase
   * - login: Connected but needs authentication
   * - ready: Connected and authenticated
   */
  const appState = ref('connecting')

  /**
   * User profile (null if not authenticated)
   */
  const profile = ref(null)

  /**
   * Last error message
   */
  const error = ref(null)

  /**
   * WebSocket manager instance
   */
  const ws = new WebSocketManager()

  // ===== Computed =====

  const isConnected = computed(() => connectionState.value === 'connected')
  const isAuthenticated = computed(() => profile.value !== null)
  const isReady = computed(() => appState.value === 'ready')
  const needsLogin = computed(() => appState.value === 'login')
  const isConnecting = computed(() => appState.value === 'connecting')

  // ===== Actions =====

  /**
   * Connect to WebSocket server
   *
   * @param {string|null} url - WebSocket URL (auto-detected if null)
   * @param {number} timeout - Connection timeout in ms
   * @returns {Promise<void>}
   *
   * @example
   * // Auto-detect URL
   * await wsStore.connect()
   *
   * @example
   * // Custom URL for development
   * await wsStore.connect('ws://localhost:3000/ws')
   */
  async function connect(url = null, timeout = 5000) {
    try {
      appState.value = 'connecting'
      connectionState.value = 'connecting'
      error.value = null

      // Set up broadcast listener for connection events BEFORE connecting
      ws.onBroadcast((method, params) => {
        if (method === 'connected') {
          connectionState.value = 'connected'
          profile.value = params.profile || null

          // Determine app state based on profile
          if (params.profile) {
            appState.value = 'ready'
          } else {
            appState.value = 'login'
          }

          console.log('[WsStore] Connected:', {
            profile: params.profile,
            appState: appState.value
          })
        }
      })

      // Connect to WebSocket
      await ws.connect(url, timeout)

      // Note: appState will be updated when 'connected' broadcast arrives

    } catch (err) {
      console.error('[WsStore] Connection failed:', err)
      connectionState.value = 'error'
      error.value = err.message
      throw err
    }
  }

  /**
   * Login with email and password
   *
   * @param {Object} credentials
   * @param {string} credentials.email
   * @param {string} credentials.password
   * @returns {Promise<Object>} Login result with token and profile
   *
   * @example
   * const result = await wsStore.login({
   *   email: 'user@example.com',
   *   password: 'password123'
   * })
   */
  async function login({ email, password }) {
    try {
      error.value = null

      const result = await ws.call('login_user', { email, password })

      if (result.token) {
        // Store token in localStorage
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('dzql_token', result.token)
        }

        // Update profile
        profile.value = result.profile
        appState.value = 'ready'

        console.log('[WsStore] Login successful:', result.profile)

        return result
      }

      throw new Error('No token received')

    } catch (err) {
      console.error('[WsStore] Login failed:', err)
      error.value = err.message
      throw err
    }
  }

  /**
   * Register a new user
   *
   * @param {Object} credentials
   * @param {string} credentials.email
   * @param {string} credentials.password
   * @returns {Promise<Object>} Registration result with token and profile
   *
   * @example
   * const result = await wsStore.register({
   *   email: 'newuser@example.com',
   *   password: 'securepass123'
   * })
   */
  async function register({ email, password }) {
    try {
      error.value = null

      const result = await ws.call('register_user', { email, password })

      if (result.token) {
        // Store token in localStorage
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('dzql_token', result.token)
        }

        // Update profile
        profile.value = result.profile
        appState.value = 'ready'

        console.log('[WsStore] Registration successful:', result.profile)

        return result
      }

      throw new Error('No token received')

    } catch (err) {
      console.error('[WsStore] Registration failed:', err)
      error.value = err.message
      throw err
    }
  }

  /**
   * Logout and clear session
   *
   * @returns {Promise<void>}
   *
   * @example
   * await wsStore.logout()
   */
  async function logout() {
    try {
      // Call server logout
      await ws.call('logout')
    } catch (err) {
      console.warn('[WsStore] Server logout failed:', err)
    }

    // Clear local state
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('dzql_token')
    }

    profile.value = null
    appState.value = 'login'

    // Reconnect to get fresh state
    await connect()

    console.log('[WsStore] Logged out')
  }

  /**
   * Disconnect from WebSocket
   */
  function disconnect() {
    ws.disconnect()
    connectionState.value = 'disconnected'
    appState.value = 'connecting'
    console.log('[WsStore] Disconnected')
  }

  /**
   * Get the WebSocket manager instance for direct API calls
   *
   * @returns {WebSocketManager}
   *
   * @example
   * const ws = wsStore.getWs()
   * const venue = await ws.api.get.venues({ id: 1 })
   */
  function getWs() {
    return ws
  }

  // ===== Return Public API =====

  return {
    // State
    connectionState,
    appState,
    profile,
    error,

    // Computed
    isConnected,
    isAuthenticated,
    isReady,
    needsLogin,
    isConnecting,

    // Actions
    connect,
    login,
    register,
    logout,
    disconnect,
    getWs
  }
})
