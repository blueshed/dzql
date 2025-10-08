<template>
  <div class="navbar bg-base-100 shadow-lg">
    <div class="navbar-start">
      <div class="dropdown">
        <div tabindex="0" role="button" class="btn btn-ghost lg:hidden">
          <MenuIcon class="h-5 w-5" />
        </div>
        <ul tabindex="0" class="menu dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52">
          <li><router-link to="/"><HomeIcon class="h-4 w-4"/> Home</router-link></li>
          <li class="mt-2 border-t border-base-300 pt-2">
            <a @click="showAbout" class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              About DZQL
            </a>
          </li>
        </ul>
      </div>
      <button class="btn btn-ghost text-xl hover:bg-primary/10 transition-colors" @click="showAbout">
        <span class="dzql-brand-text">{{ config.app.name }}</span>
      </button>
    </div>

    <div class="navbar-center hidden lg:flex">
      <ul class="menu menu-horizontal px-1">
        <li><router-link to="/"><HomeIcon class="h-4 w-4"/> Home</router-link></li>
      </ul>
    </div>

    <div class="navbar-end">
      <!-- Theme Toggle -->
      <label class="swap swap-rotate btn btn-ghost btn-circle">
        <input type="checkbox" class="theme-controller" value="dzql-dark" @change="toggleTheme" />

        <!-- sun icon -->
        <SunIcon class="swap-off w-5 h-5" />

        <!-- moon icon -->
        <MoonIcon class="swap-on w-5 h-5" />
      </label>

      <!-- User Menu -->
      <div class="dropdown dropdown-end">
        <div tabindex="0" role="button" class="btn btn-ghost btn-circle avatar">
          <div class="w-10 rounded-full dzql-brand-gradient">
            <div class="flex items-center justify-center h-full text-lg font-semibold text-white">
              {{ userInitials }}
            </div>
          </div>
        </div>
        <ul tabindex="0" class="menu dropdown-content mt-3 z-[1] p-2 shadow bg-base-100 rounded-box w-52">
          <li class="menu-title">
            <span>{{ user?.email || 'User' }}</span>
          </li>
          <li><a @click="showProfile">Profile</a></li>
          <li><a @click="showSettings">Settings</a></li>
          <li class="mt-2">
            <a @click="handleLogout" class="text-error">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
              Logout
            </a>
          </li>
        </ul>
      </div>
    </div>

    <!-- About Modal -->
    <AboutModal ref="aboutModalRef" />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useProfileStore } from '../stores/main'
import AboutModal from './AboutModal.vue'

import HomeIcon from '@feather-icons/home.svg?component'
import MenuIcon from '@feather-icons/menu.svg?component'
import SunIcon from '@feather-icons/sun.svg?component'
import MoonIcon from '@feather-icons/moon.svg?component'

const props = defineProps({
  user: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['logout'])
const router = useRouter()
const profileStore = useProfileStore()
const config = profileStore.uiConfig
const aboutModalRef = ref(null)

// Computed
const userInitials = computed(() => {
  if (props.user?.name) {
    return props.user.name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }
  if (props.user?.email) {
    return props.user.email[0].toUpperCase()
  }
  return 'U'
})

// Methods
const capitalize = (str) => {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

const toggleTheme = (event) => {
  const theme = event.target.checked ? 'dzql-dark' : 'dzql'
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem('theme', theme)

  // Update UI config theme
  config.app.theme = theme
}

const showProfile = () => {
  // Navigate to profile page when implemented
  console.log('Show profile for:', props.user)
  // router.push('/profile')
}

const showSettings = () => {
  // Navigate to settings page when implemented
  console.log('Show settings')
  // router.push('/settings')
}

const showAbout = () => {
  aboutModalRef.value?.openModal()
}

const handleLogout = () => {
  if (confirm('Are you sure you want to logout?')) {
    emit('logout')
  }
}

// Set initial theme
onMounted(() => {
  // Use config theme as default, fallback to localStorage, then 'dzql'
  const savedTheme = localStorage.getItem('theme') || config.app.theme || 'dzql'
  document.documentElement.setAttribute('data-theme', savedTheme)
  const themeToggle = document.querySelector('.theme-controller')
  if (themeToggle) {
    themeToggle.checked = savedTheme === 'dzql-dark'
  }

  // Sync config with actual theme
  config.app.theme = savedTheme
})
</script>

<style scoped>
@reference '@/style.css';

/* Smooth transition for theme toggle */
.swap {
  transition: transform 0.2s ease;
}

.swap:active {
  transform: scale(0.95);
}

/* Active route styling */
.router-link-active {
  @apply font-semibold;
}
</style>
