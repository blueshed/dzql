import { ref } from 'vue'
import { ws } from '@generated/client/ws'

const ready = ref(false)
const user = ref<any>(null)
const connectionError = ref<string | null>(null)

export function useDzql() {
  async function connect(url?: string) {
    try {
      connectionError.value = null
      ready.value = false

      await ws.connect(url || '/ws')

      // Connection successful - check if we have a stored token
      const token = localStorage.getItem('dzql_token')
      if (token) {
        // Token was sent with connection, user should be authenticated
        // The server sends back the user profile on connection:ready
      }

      ready.value = true
    } catch (e: any) {
      connectionError.value = e.message
      throw e
    }
  }

  async function login(email: string, password: string) {
    const result = await ws.api.login_user({ email, password }) as any
    if (result?.user_id) {
      user.value = result
      if (result.token) {
        localStorage.setItem('dzql_token', result.token)
      }
    }
    return result
  }

  async function register(name: string, email: string, password: string) {
    const result = await ws.api.register_user({ name, email, password }) as any
    if (result?.user_id) {
      user.value = result
      if (result.token) {
        localStorage.setItem('dzql_token', result.token)
      }
    }
    return result
  }

  async function logout() {
    localStorage.removeItem('dzql_token')
    user.value = null
    // Disconnect and reconnect without token
    ws.disconnect()
    await connect()
  }

  return { ws, ready, user, connectionError, connect, login, register, logout }
}
