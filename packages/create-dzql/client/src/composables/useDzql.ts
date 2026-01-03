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

      // Wait for connection:ready and sync user state
      await new Promise<void>((resolve) => {
        if (ws.ready) {
          user.value = ws.user
          resolve()
        } else {
          const unsub = ws.onReady((u: any) => {
            user.value = u
            unsub()
            resolve()
          })
        }
      })

      ready.value = true
    } catch (e: any) {
      connectionError.value = e.message
      throw e
    }
  }

  async function login(email: string, password: string) {
    const result = await ws.api.login_user({ email, password }) as any
    if (result?.user_id) {
      // Normalize user object: use 'id' for consistency with entity references
      user.value = { ...result, id: result.user_id }
      if (result.token) {
        localStorage.setItem('dzql_token', result.token)
      }
    }
    return result
  }

  async function register(name: string, email: string, password: string) {
    const result = await ws.api.register_user({ name, email, password }) as any
    if (result?.user_id) {
      // Normalize user object: use 'id' for consistency with entity references
      user.value = { ...result, id: result.user_id }
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
