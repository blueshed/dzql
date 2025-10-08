<template>
  <div class="flex flex-col min-h-screen">

    <!-- Mobile Breadcrumb -->
    <Breadcrumb
      class="md:hidden"
      :context_label="contextLabel"
      :content_label="contentLabel"
      :properties_label="propertiesLabel"
      :active_view="mobile_view"
      @navigate="navigate_to_panel"
    />

    <!-- Desktop Header with Toggle Buttons -->
    <div class="hidden md:flex items-center justify-between bg-base-100 border-b px-6 py-3">
      <div class="flex items-center gap-4">
        <h1 class="text-xl font-bold text-base-content">{{ title }}</h1>
      </div>
      <div class="flex items-center gap-2">
        <button
          @click="show_context_panel = !show_context_panel"
          :class="[
            'btn btn-sm btn-ghost',
            show_context_panel ? 'btn-active' : ''
          ]"
          title="Toggle Context Panel"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z" />
          </svg>
        </button>
        <button
          @click="show_properties_panel = !show_properties_panel"
          :class="[
            'btn btn-sm btn-ghost',
            show_properties_panel ? 'btn-active' : ''
          ]"
          title="Toggle Properties Panel"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Three Panel Layout -->
    <div class="flex-1 flex min-h-0">

      <!-- CONTEXT PANEL -->
      <div :class="[
        'w-full md:w-64 bg-base-200 md:border-r border-base-300 flex flex-col',
        mobile_view === 'context' ? 'block' : 'hidden',
        show_context_panel ? 'md:block' : 'md:hidden'
      ]">
        <slot name="context" />
      </div>

      <!-- CONTENT PANEL -->
      <div :class="[
        'flex-1 bg-base-100 flex flex-col',
        mobile_view === 'content' ? 'block md:block' : 'hidden md:block'
      ]">
        <slot name="content" />
      </div>

      <!-- PROPERTIES PANEL -->
      <div :class="[
        'w-full md:w-96 bg-base-100 md:border-l border-base-300 flex flex-col',
        mobile_view === 'properties' ? 'block' : 'hidden',
        show_properties_panel ? 'md:block' : 'md:hidden'
      ]">
        <slot name="properties" />
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import Breadcrumb from './Breadcrumb.vue'

const props = defineProps({
  title: {
    type: String,
    default: 'DZQL Admin'
  },
  contextLabel: {
    type: String,
    default: 'Entities'
  },
  contentLabel: {
    type: String,
    default: 'Content'
  },
  propertiesLabel: {
    type: String,
    default: 'Properties'
  }
})

const route = useRoute()

// Desktop panel visibility
const show_context_panel = ref(true)
const show_properties_panel = ref(true)

// Mobile active panel
const mobile_view = ref('context') // 'context' | 'content' | 'properties'

// Detect mobile
const window_width = ref(window.innerWidth)
const is_mobile = computed(() => window_width.value < 768)

// Handle window resize
const handleResize = () => {
  window_width.value = window.innerWidth
}

// Navigate between panels on mobile
const navigate_to_panel = (panel) => {
  mobile_view.value = panel
}

// Auto-navigate based on route changes
const updateMobileViewFromRoute = () => {
  if (!is_mobile.value) return

  if (route.params.id || route.params.entity === 'new') {
    // Editing or creating - show properties
    mobile_view.value = 'properties'
  } else if (route.params.entity) {
    // Viewing entity list - show content
    mobile_view.value = 'content'
  } else {
    // Home - show context
    mobile_view.value = 'context'
  }
}

// Lifecycle
onMounted(() => {
  window.addEventListener('resize', handleResize)
  updateMobileViewFromRoute()
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

// Expose navigate function to parent
defineExpose({
  navigate_to_panel
})
</script>

<style scoped>
/* Smooth transitions for panel toggles */
.md\:block, .md\:hidden {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
</style>
