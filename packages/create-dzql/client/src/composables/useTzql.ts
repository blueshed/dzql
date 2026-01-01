import { ref } from 'vue'
import { WebSocketManager } from 'dzql/client'

const ws = new WebSocketManager()
const ready = ref(false)
const user = ref<any>(null)
const connectionError = ref<string | null>(null)

export function useTzql() {
  async function connect(url?: string) {
    try {
      connectionError.value = null
      ready.value = false

      ws.onReady((profile: any) => {
        if (!profile && localStorage.getItem('token')) {
          localStorage.removeItem('token')
        }
        user.value = profile
        ready.value = true
      })

      await ws.connect(url || '/ws')
    } catch (e: any) {
      connectionError.value = e.message
      throw e
    }
  }

  async function login(email: string, password: string) {
    const result = await ws.login({ email, password })
    if (result?.user_id) {
      user.value = result
    }
    return result
  }

  async function register(name: string, email: string, password: string) {
    const result = await ws.register({ name, email, password })
    if (result?.user_id) {
      user.value = result
    }
    return result
  }

  async function logout() {
    await ws.logout()
    user.value = null
  }

  return { ws, ready, user, connectionError, connect, login, register, logout }
}
