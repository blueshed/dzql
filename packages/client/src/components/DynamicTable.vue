<template>
  <div class="space-y-4">
    <!-- Search Bar -->
    <div class="flex flex-col sm:flex-row gap-4">
      <div class="flex-1">
        <input
          v-model="searchFilter"
          type="text"
          placeholder="Search..."
          class="input input-bordered w-full"
          @input="debouncedSearch"
        />
      </div>
      <button
        @click="refresh"
        class="btn btn-primary"
        :disabled="loading"
      >
        <span v-if="loading" class="loading loading-spinner loading-sm"></span>
        <RefreshCwIcon v-else class="h-4 w-4" />
        Refresh
      </button>
      <div class="dropdown dropdown-end">
        <button
          tabindex="0"
          class="btn btn-secondary"
          :disabled="!hasData"
        >
          <DownloadIcon class="h-4 w-4" />
          Export
        </button>
        <ul tabindex="0" class="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-52">
          <li><a @click="handleExport('csv')">Export as CSV</a></li>
          <li><a @click="handleExport('json')">Export as JSON</a></li>
        </ul>
      </div>
    </div>

    <!-- Error Alert -->
    <div v-if="error" class="alert alert-error">
      <XCircleIcon class="stroke-current shrink-0 h-6 w-6" />
      <span>{{ error }}</span>
      <button @click="clearError" class="btn btn-sm btn-ghost">×</button>
    </div>

    <!-- Loading State -->
    <div v-if="loading && !hasData" class="flex justify-center py-12">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>

    <!-- Table -->
    <div v-else-if="hasData" class="overflow-x-auto">
      <table class="table table-zebra">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column.key">
              <button
                @click="toggleSort(column.key)"
                class="btn btn-ghost btn-sm justify-start p-0 h-auto font-semibold"
                :class="{ 'text-primary': sortField === column.key }"
              >
                {{ column.label }}
                <span v-if="sortField === column.key" class="ml-1">
                  {{ sortOrder === 'asc' ? '↑' : '↓' }}
                </span>
              </button>
            </th>
            <th class="w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in records" :key="record.id || record.pk">
            <td v-for="column in columns" :key="column.key" class="max-w-xs">
              <!-- Foreign Key Link -->
              <button
                v-if="column.isForeignKey && record[column.key]"
                @click.stop="navigateToForeignKey(column.referencedEntity, record[column.key])"
                class="link link-primary truncate"
                :title="`View ${column.referencedEntity}: ${getDisplayValue(record, column.key)}`"
              >
                {{ getDisplayValue(record, column.key) }}
              </button>
              <!-- Regular Value -->
              <div v-else class="truncate" :title="getDisplayValue(record, column.key)">
                {{ getDisplayValue(record, column.key) }}
              </div>
            </td>
            <td>
              <div class="flex gap-1">
                <button
                  @click="editRecord(record)"
                  class="btn btn-ghost btn-xs"
                  title="Edit"
                >
                  <EditIcon class="h-3 w-3" />
                </button>
                <button
                  @click="deleteRecord(record)"
                  class="btn btn-ghost btn-xs text-error hover:bg-error hover:text-error-content"
                  title="Delete"
                >
                  <TrashIcon class="h-3 w-3" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Empty State -->
    <div v-else-if="!loading" class="text-center py-12">
      <div class="text-base-content/60">
        <InboxIcon class="mx-auto h-12 w-12 mb-4" />
        <h3 class="text-lg font-medium mb-2">No {{ entity }} found</h3>
        <p class="text-sm">Try adjusting your search or create a new record.</p>
      </div>
      <button class="btn btn-primary mt-4" @click="createRecord">
        <PlusIcon class="h-4 w-4 mr-2" />
        Create {{ entity }}
      </button>
    </div>

    <!-- Pagination -->
    <div v-if="searchResults && searchResults.total > searchResults.limit" class="flex justify-between items-center">
      <div class="text-sm text-base-content/70">
        Showing {{ ((searchResults.page - 1) * searchResults.limit) + 1 }} to
        {{ Math.min(searchResults.page * searchResults.limit, searchResults.total) }} of
        {{ searchResults.total }} results
      </div>
      <div class="join">
        <button
          @click="goToPage(searchResults.page - 1)"
          :disabled="searchResults.page <= 1 || loading"
          class="join-item btn btn-sm"
        >
          « Previous
        </button>
        <button
          @click="goToPage(searchResults.page + 1)"
          :disabled="searchResults.page >= totalPages || loading"
          class="join-item btn btn-sm"
        >
          Next »
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'
import { useMetaStore } from '../stores/meta'
import { useExport } from '../composables/useExport'
import { useNotifications } from '../composables/useNotifications'
import RefreshCwIcon from '@feather-icons/refresh-cw.svg?component'
import XCircleIcon from '@feather-icons/x-circle.svg?component'
import EditIcon from '@feather-icons/edit-2.svg?component'
import TrashIcon from '@feather-icons/trash-2.svg?component'
import InboxIcon from '@feather-icons/inbox.svg?component'
import PlusIcon from '@feather-icons/plus.svg?component'
import DownloadIcon from '@feather-icons/download.svg?component'

const props = defineProps({
  entity: {
    type: String,
    required: true
  },
  store: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['edit', 'create', 'delete'])

const router = useRouter()
const metaStore = useMetaStore()
const { exportToCSV, exportToJSON } = useExport()
const { success, error: notifyError } = useNotifications()

// Local state
const searchFilter = ref('')
const sortField = ref('id')
const sortOrder = ref('asc')

// Store state - use storeToRefs for reactive state
const { records, loading, error, searchResults, hasData, totalPages } = storeToRefs(props.store)
// Methods don't need storeToRefs
const { search, clearError } = props.store

// Computed
const columns = computed(() => {
  if (!hasData.value) return []

  // Get first record to determine columns
  const firstRecord = records.value[0]
  if (!firstRecord) return []

  // Get foreign key information
  const fkFields = metaStore.getForeignKeyFields(props.entity)

  return Object.keys(firstRecord)
    .filter(key => key !== 'id') // Hide ID column
    .slice(0, 6) // Limit columns for mobile
    .map(key => {
      const fk = fkFields.find(f => f.column === key)
      return {
        key,
        label: key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        isForeignKey: !!fk,
        referencedEntity: fk?.referencedEntity
      }
    })
})

// Methods
let searchTimeout = null
const debouncedSearch = () => {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    performSearch()
  }, 300)
}

const performSearch = async () => {
  const params = {
    page: 1,
    limit: 25
  }

  if (searchFilter.value.trim()) {
    params.filters = {
      _search: searchFilter.value.trim()
    }
  }

  if (sortField.value) {
    params.sort = {
      field: sortField.value,
      order: sortOrder.value
    }
  }

  await search(params)
}

const refresh = () => {
  performSearch()
}

const toggleSort = (field) => {
  if (sortField.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = field
    sortOrder.value = 'asc'
  }
  performSearch()
}

const goToPage = async (page) => {
  if (page < 1 || page > totalPages.value) return

  const params = {
    ...props.store.searchParams,
    page
  }

  await search(params)
}

const getDisplayValue = (record, key) => {
  const value = record[key]
  if (value === null || value === undefined) return '-'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const editRecord = (record) => {
  emit('edit', record)
}

const createRecord = () => {
  emit('create')
}

const deleteRecord = (record) => {
  emit('delete', record)
}

const navigateToForeignKey = (entityName, id) => {
  router.push(`/${entityName}/${id}`)
}

const handleExport = (format) => {
  try {
    const filename = `${props.entity}_${new Date().toISOString().split('T')[0]}`

    if (format === 'csv') {
      exportToCSV(records.value, `${filename}.csv`)
      success('Data exported as CSV')
    } else if (format === 'json') {
      exportToJSON(records.value, `${filename}.json`)
      success('Data exported as JSON')
    }
  } catch (err) {
    console.error('Export failed:', err)
    notifyError(err.message || 'Failed to export data')
  }
}

// Watch for store changes to trigger new search
// When entity changes, a new store is passed in, so this will fire
watch(() => props.store, (newStore, oldStore) => {
  if (newStore !== oldStore) {
    // Clear search filter when switching entities
    searchFilter.value = ''
    sortField.value = 'id'
    sortOrder.value = 'asc'
    performSearch()
  }
}, { immediate: true })
</script>

<style scoped>
@reference '@/style.css';
/* Custom scrollbar for table */
.overflow-x-auto::-webkit-scrollbar {
  height: 6px;
}

.overflow-x-auto::-webkit-scrollbar-track {
  @apply bg-base-200;
}

.overflow-x-auto::-webkit-scrollbar-thumb {
  @apply bg-base-content/20 rounded-full;
}

.overflow-x-auto::-webkit-scrollbar-thumb:hover {
  @apply bg-base-content/30;
}
</style>
