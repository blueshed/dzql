<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div v-if="entity" class="p-4 border-b border-base-300 flex justify-between items-center bg-base-100">
      <div class="flex items-center gap-3">
        <component
          :is="entityIcon"
          class="w-6 h-6 text-primary flex-shrink-0"
        />
        <h2 class="font-semibold text-lg capitalize">{{ formatEntityName(entity) }}</h2>
      </div>
      <button
        @click="createNew"
        class="btn btn-primary btn-sm gap-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New
      </button>
    </div>

    <!-- Table -->
    <div class="flex-1 overflow-auto p-4">
      <DynamicTable
        v-if="entity && store"
        :entity="entity"
        :store="store"
        @edit="handleRowClick"
        @create="createNew"
        @delete="handleDelete"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useMetaStore } from '../stores/meta'
import { useEntityStore } from '../stores/entityFactory'
import { useNotifications } from '../composables/useNotifications'
import { useConfirmDialog } from '../composables/useConfirmDialog'
import DynamicTable from './DynamicTable.vue'

const router = useRouter()
const route = useRoute()
const metaStore = useMetaStore()
const { success, error: notifyError } = useNotifications()
const { confirmDelete } = useConfirmDialog()

const props = defineProps({
  entity: {
    type: String,
    default: null
  }
})

// Get entity store
const store = computed(() => {
  return props.entity ? useEntityStore(props.entity) : null
})

// Get entity icon
const entityIcon = computed(() => {
  return props.entity ? metaStore.getEntityIcon(props.entity) : null
})

// Format entity name
const formatEntityName = (name) => {
  if (!name) return ''
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Handle row click - navigate to edit
const handleRowClick = (record) => {
  const id = record.id || record[Object.keys(record)[0]] // Fallback to first field if no id
  router.push(`/${props.entity}/${id}`)

  // Auto-navigate to properties panel on mobile
  const isMobile = window.innerWidth < 768
  if (isMobile) {
    // Parent (ThreePanelLayout) will handle this via route watching
  }
}

// Handle create new
const createNew = () => {
  router.push(`/${props.entity}/new`)

  // Auto-navigate to properties panel on mobile
  const isMobile = window.innerWidth < 768
  if (isMobile) {
    // Parent (ThreePanelLayout) will handle this via route watching
  }
}

// Handle delete
const handleDelete = async (record) => {
  const id = record.id || record[Object.keys(record)[0]]
  const entityName = formatEntityName(props.entity)

  // Show confirmation dialog
  const confirmed = await confirmDelete(entityName)
  if (!confirmed) return

  try {
    await store.value.delete(id)
    success(`${entityName} deleted successfully`)
  } catch (error) {
    console.error('Delete failed:', error)
    notifyError(error.message || 'Failed to delete')
  }
}
</script>

<style scoped>
/* Component styles handled by Tailwind */
</style>
