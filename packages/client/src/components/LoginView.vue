<template>
  <div class="hero min-h-screen bg-base-200">
    <div class="hero-content flex-col w-full max-w-sm">
      <div class="text-center mb-8">
        <h1 class="text-4xl font-bold">ZeroQL</h1>
        <p class="text-base-content/60">Sign in to continue</p>
      </div>

      <div class="card w-full bg-base-100 shadow-xl">
        <div class="card-body">
          <!-- Simple Tab Toggle -->
          <div class="tabs tabs-boxed mb-6">
            <a
              class="tab flex-1"
              :class="{ 'tab-active': mode === 'login' }"
              @click="mode = 'login'"
            >
              Login
            </a>
            <a
              class="tab flex-1"
              :class="{ 'tab-active': mode === 'register' }"
              @click="mode = 'register'"
            >
              Register
            </a>
          </div>

          <!-- Error Alert -->
          <div v-if="error" class="alert alert-error mb-4">
            <XIcon class="h-5 w-5" />
            <span>{{ error }}</span>
          </div>

          <!-- Success Alert -->
          <div v-if="success" class="alert alert-success mb-4">
            <CheckIcon class="h-5 w-5" />
            <span>{{ success }}</span>
          </div>

          <!-- Form -->
          <form @submit.prevent="handleSubmit" class="space-y-4">
            <div class="form-control">
              <input
                ref="emailInput"
                v-model="email"
                type="email"
                placeholder="Email"
                class="input input-bordered w-full"
                required
                :disabled="loading"
              />
            </div>

            <div class="form-control">
              <div class="relative">
                <input
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  placeholder="Password"
                  class="input input-bordered w-full pr-12"
                  required
                  :disabled="loading"
                  :minlength="mode === 'register' ? 8 : 1"
                />
                <button
                  type="button"
                  class="btn btn-ghost btn-sm absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 p-0"
                  @click="showPassword = !showPassword"
                  :disabled="loading"
                >
                  <EyeIcon v-if="!showPassword" class="h-4 w-4" />
                  <EyeOffIcon v-else class="h-4 w-4" />
                </button>
              </div>
            </div>

            <div v-if="mode === 'register'" class="form-control">
              <input
                v-model="confirmPassword"
                type="password"
                placeholder="Confirm Password"
                class="input input-bordered w-full"
                required
                :disabled="loading"
              />
            </div>

            <button
              type="submit"
              class="btn btn-primary w-full"
              :disabled="loading || !isFormValid"
            >
              <span v-if="loading" class="loading loading-spinner loading-sm"></span>
              {{ mode === 'login' ? 'Sign In' : 'Create Account' }}
            </button>
          </form>

          <!-- Test Account -->
          <div class="divider text-xs">test account</div>
          <button
            @click="fillTestCredentials"
            class="btn btn-ghost btn-sm w-full"
            :disabled="loading"
          >
            test@example.com
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted } from 'vue'
import { useWs } from 'zeroql/client'
import { useProfileStore } from '../stores/main'
import CheckIcon from 'feather-icons/dist/icons/check.svg?component'
import XIcon from 'feather-icons/dist/icons/x.svg?component'
import EyeIcon from 'feather-icons/dist/icons/eye.svg?component'
import EyeOffIcon from 'feather-icons/dist/icons/eye-off.svg?component'

const emit = defineEmits(['authenticated'])
const ws = useWs()
const profileStore = useProfileStore()

// Form state
const mode = ref('login')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const loading = ref(false)
const error = ref('')
const success = ref('')

// Refs
const emailInput = ref(null)

// Computed
const isFormValid = computed(() => {
  if (!email.value || !password.value) return false
  if (mode.value === 'register') {
    if (password.value.length < 8) return false
    if (password.value !== confirmPassword.value) return false
  }
  return true
})

// Methods
const fillTestCredentials = () => {
  email.value = 'test@example.com'
  password.value = 'password123'
  if (mode.value === 'register') {
    confirmPassword.value = 'password123'
  }
  error.value = ''
  success.value = ''
}

const handleSubmit = async () => {
  if (!isFormValid.value) return

  error.value = ''
  success.value = ''
  loading.value = true

  try {
    const method = mode.value === 'login' ? 'login_user' : 'register_user'
    const result = await ws.call(method, {
      email: email.value,
      password: password.value
    })

    if (result.token) {
      localStorage.setItem('zeroql_token', result.token)
      profileStore.profile = result.profile

      if (mode.value === 'register') {
        success.value = 'Account created successfully!'
        setTimeout(() => {
          emit('authenticated', result.profile)
        }, 1000)
      } else {
        emit('authenticated', result.profile)
      }
    }
  } catch (err) {
    const message = err.message || 'Authentication failed'

    if (message.includes('Email already exists')) {
      error.value = 'Email already registered. Try logging in.'
      mode.value = 'login'
    } else if (message.includes('Invalid credentials')) {
      error.value = 'Invalid email or password'
    } else {
      error.value = message
    }
  } finally {
    loading.value = false
  }
}

// Focus email input on mount
onMounted(() => {
  emailInput.value?.focus()
})
</script>

<style scoped>
/* Clean transitions */
.form-control {
  transition: all 0.2s ease;
}

.btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

/* Mobile optimizations */
@media (max-width: 640px) {
  .hero-content {
    padding: 1rem;
    width: calc(100% - 2rem);
  }
}
</style>
