<template>
  <div class="bg-base-100 border-b border-base-300 px-4 py-2">
    <nav class="flex items-center text-sm">

      <button
        @click="$emit('navigate', 'context')"
        :class="[
          'transition-colors',
          active_view === 'context'
            ? 'text-primary font-semibold'
            : 'text-base-content/70 hover:text-base-content'
        ]"
      >
        {{ context_label }}
      </button>

      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 text-base-content/40 mx-1">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>

      <button
        @click="$emit('navigate', 'content')"
        :class="[
          'transition-colors',
          active_view === 'content'
            ? 'text-primary font-semibold'
            : 'text-base-content/70 hover:text-base-content'
        ]"
      >
        {{ content_label }}
      </button>

      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 text-base-content/40 mx-1">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
      </svg>

      <button
        @click="$emit('navigate', 'properties')"
        :class="[
          'transition-colors',
          active_view === 'properties'
            ? 'text-primary font-semibold'
            : 'text-base-content/70 hover:text-base-content'
        ]"
      >
        {{ properties_label }}
      </button>

    </nav>
  </div>
</template>

<script setup>
defineProps({
  context_label: {
    type: String,
    default: 'Context'
  },
  content_label: {
    type: String,
    default: 'Content'
  },
  properties_label: {
    type: String,
    default: 'Properties'
  },
  active_view: {
    type: String,
    default: 'context',
    validator: (value) => ['context', 'content', 'properties'].includes(value)
  }
})

defineEmits(['navigate'])
</script>

<style scoped>
button {
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
}

button:active {
  transform: scale(0.98);
}
</style>
