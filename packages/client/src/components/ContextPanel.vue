<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="p-4 border-b border-base-300 bg-base-100">
      <h2 class="font-semibold text-base-content mb-3">Entities</h2>
      <input
        v-model="searchQuery"
        type="search"
        placeholder="Search entities..."
        class="input input-sm input-bordered w-full"
      />
    </div>

    <!-- Entity List -->
    <div class="flex-1 overflow-auto">
      <div v-if="loading" class="flex items-center justify-center p-8">
        <span class="loading loading-spinner loading-md text-primary"></span>
      </div>

      <div v-else-if="error" class="p-4">
        <div class="alert alert-error">
          <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{{ error }}</span>
        </div>
      </div>

      <div v-else-if="!metadata" class="p-4 text-center text-base-content/60">
        <p class="text-sm">No metadata loaded</p>
      </div>

      <div v-else-if="filteredEntities.length === 0" class="p-4 text-center text-base-content/60">
        <p class="text-sm">No entities found</p>
      </div>

      <ul v-else class="menu menu-sm p-2">
        <li
          v-for="entity in filteredEntities"
          :key="entity.table_name"
        >
          <a @click="selectEntity(entity.table_name)">
            {{ formatEntityName(entity.table_name) }}
          </a>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useMetaStore } from '../stores/meta'

const router = useRouter()
const route = useRoute()
const metaStore = useMetaStore()
const { loading, error, metadata, entitiesList } = storeToRefs(metaStore)

// Search query
const searchQuery = ref('')

// Filtered entities based on search
const filteredEntities = computed(() => {
  const list = entitiesList.value
  console.log('filteredEntities - list:', list)
  console.log('filteredEntities - list.length:', list.length)
  console.log('filteredEntities - loading:', loading.value)
  console.log('filteredEntities - error:', error.value)
  console.log('filteredEntities - metadata:', metadata.value)

  const query = searchQuery.value.toLowerCase().trim()

  if (!query) {
    return list
  }

  return list.filter(entity => {
    const name = (entity.table_name || '').toLowerCase()
    const searchableFields = (entity.searchable_fields || []).join(' ').toLowerCase()
    return name.includes(query) || searchableFields.includes(query)
  })
})

// Select entity and navigate
const selectEntity = (entityName) => {
  router.push(`/${entityName}`)

  // Auto-navigate to content panel on mobile
  const isMobile = window.innerWidth < 768
  if (isMobile) {
    // Emit event to parent to change mobile view
    // Parent (ThreePanelLayout) will handle this via route watching
  }
}

// Format entity name for display
const formatEntityName = (name) => {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Get available operations for entity
const getOperations = (entity) => {
  return metaStore.getAvailableOperations(entity.table_name)
}
</script>

<style scoped>
@reference "../style.css";

/* Custom scrollbar */
.overflow-auto::-webkit-scrollbar {
  width: 6px;
}

.overflow-auto::-webkit-scrollbar-track {
  @apply bg-base-200;
}

.overflow-auto::-webkit-scrollbar-thumb {
  @apply bg-base-content/20 rounded-full;
}

.overflow-auto::-webkit-scrollbar-thumb:hover {
  @apply bg-base-content/30;
}
</style>
