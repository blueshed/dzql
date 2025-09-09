<template>
  <div class="p-4 sm:p-6">
    <div class="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
      <component :is="entityIcon" class="h-6 w-6 sm:h-8 sm:w-8 text-primary flex-shrink-0" />
      <h1 class="text-2xl sm:text-3xl font-bold capitalize truncate">{{ props.entity }}</h1>
    </div>

    <DynamicTable
      :entity="props.entity"
      :store="store"
      @edit="handleEdit"
      @create="handleCreate"
      @delete="handleDelete"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useProfileStore } from '../stores/main'
import { useEntityStore } from '../stores/entityFactory'
import DynamicTable from './DynamicTable.vue'

const props = defineProps({
  entity: String
})

const profileStore = useProfileStore()
const config = profileStore.uiConfig
const store = useEntityStore(props.entity)

// Get entity icon
const entityIcon = computed(() => config.icons[props.entity])

// Real-time updates
onMounted(() => {
  // Listen for real-time updates for this entity
  const ws = store.ws || profileStore.ws
  if (ws) {
    ws.onBroadcast((method, params) => {
      if (method === `${props.entity}:update` || method === `${props.entity}:create` || method === `${props.entity}:delete`) {
        store.handleRealTimeUpdate(params)
      }
    })
  }
})

// Event handlers
const handleEdit = (record) => {
  console.log('Edit record:', record)
  // TODO: Open edit modal/form
}

const handleCreate = () => {
  console.log('Create new record')
  // TODO: Open create modal/form
}

const handleDelete = async (record) => {
  try {
    await store.delete(record.id)
    console.log('Record deleted successfully')
  } catch (error) {
    console.error('Delete failed:', error)
  }
}
</script>

<style scoped>
/* Component styles handled by Tailwind classes */
</style>
