<template>
  <div class="w-full h-full overflow-auto">
    <!-- Loading state -->
    <div v-if="loading" class="flex items-center justify-center h-64">
      <span class="loading loading-spinner loading-lg"></span>
    </div>

    <!-- Empty state -->
    <div v-else-if="!records || records.length === 0" class="flex flex-col items-center justify-center h-64 text-base-content/60">
      <svg class="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
      </svg>
      <p class="text-lg font-semibold mb-2">No records yet</p>
      <p class="text-sm">Click "Add New" to create your first record</p>
    </div>

    <!-- Data grid -->
    <table v-else class="table table-pin-rows table-pin-cols">
      <thead>
        <tr>
          <!-- Row number column -->
          <th class="bg-base-200 w-16 text-center">#</th>

          <!-- Dynamic columns from metadata -->
          <th
            v-for="column in visibleColumns"
            :key="column.column_name"
            class="bg-base-200 min-w-[150px]"
          >
            <div class="flex items-center gap-2">
              <span>{{ formatColumnName(column.column_name) }}</span>
              <span v-if="!column.is_nullable" class="text-error text-xs">*</span>
              <button
                v-if="column.column_name !== 'id'"
                type="button"
                class="btn btn-ghost btn-xs opacity-50 hover:opacity-100"
                @click="toggleSort(column.column_name)"
              >
                <svg v-if="sortField !== column.column_name" class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
                <svg v-else-if="sortDirection === 'asc'" class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                </svg>
                <svg v-else class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
          </th>

          <!-- Actions column -->
          <th class="bg-base-200 w-24">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(record, index) in records"
          :key="record.id || index"
          class="hover:bg-base-200/50 transition-colors"
        >
          <!-- Row number -->
          <td class="text-center text-base-content/60 font-mono text-sm">
            {{ index + 1 }}
          </td>

          <!-- Dynamic cells -->
          <td
            v-for="column in visibleColumns"
            :key="`${record.id}-${column.column_name}`"
            class="p-0"
          >
            <component
              :is="getCellComponent(column)"
              v-model="record[column.column_name]"
              v-bind="getCellProps(column)"
              :readonly="column.column_name === 'id'"
              @save="(value) => handleCellSave(record, column.column_name, value)"
            />
          </td>

          <!-- Actions -->
          <td class="p-2">
            <div class="flex gap-1">
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                title="View details"
                @click="viewDetails(record)"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs text-error"
                title="Delete"
                @click="handleDelete(record)"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, markRaw } from 'vue'
import { useRouter } from 'vue-router'
import { useMetaStore } from '../stores/meta'
import { getCellType } from './cells/CellFactory'

// Import all cell components
import TextCell from './cells/TextCell.vue'
import NumberCell from './cells/NumberCell.vue'
import BooleanCell from './cells/BooleanCell.vue'
import DateCell from './cells/DateCell.vue'
import ForeignKeyCell from './cells/ForeignKeyCell.vue'
import CoordinateCell from './cells/CoordinateCell.vue'
import JSONCell from './cells/JSONCell.vue'
import TextAreaCell from './cells/TextAreaCell.vue'

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

const router = useRouter()
const metaStore = useMetaStore()

// Component registry (using markRaw to prevent reactivity overhead)
const cellComponents = {
  TextCell: markRaw(TextCell),
  NumberCell: markRaw(NumberCell),
  BooleanCell: markRaw(BooleanCell),
  DateCell: markRaw(DateCell),
  ForeignKeyCell: markRaw(ForeignKeyCell),
  CoordinateCell: markRaw(CoordinateCell),
  JSONCell: markRaw(JSONCell),
  TextAreaCell: markRaw(TextAreaCell)
}

// Reactive data from store
const records = computed(() => props.store.records)
const loading = computed(() => props.store.loading)

// Sorting state
const sortField = ref(null)
const sortDirection = ref('asc')

// Get metadata for current entity
const metadata = computed(() => metaStore.entities[props.entity])
const columns = computed(() => metadata.value?.columns || [])
const relations = computed(() => metadata.value?.relations || [])

// Filter out system columns and show user-facing columns
const visibleColumns = computed(() => {
  return columns.value.filter(col => {
    // Always show id
    if (col.column_name === 'id') return true

    // Hide system columns
    if (['created_at', 'updated_at', 'deleted_at'].includes(col.column_name)) return false

    return true
  })
})

// Get cell component for a column
function getCellComponent(column) {
  const cellType = getCellType(column, relations.value, props.entity)
  return cellComponents[cellType.component] || cellComponents.TextCell
}

// Get props to pass to cell component
function getCellProps(column) {
  const cellType = getCellType(column, relations.value, props.entity)
  const props = {
    columnName: column.column_name
  }

  if (cellType.type === 'foreign-key') {
    props.referencedEntity = cellType.referencedEntity
  }

  return props
}

// Format column name for display
function formatColumnName(name) {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Toggle sort
function toggleSort(field) {
  if (sortField.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = field
    sortDirection.value = 'asc'
  }
}

// Handle cell save
async function handleCellSave(record, columnName, value) {
  try {
    await props.store.update(record.id, {
      [columnName]: value
    })
  } catch (err) {
    console.error('Failed to update cell:', err)
    // Optionally show toast notification
  }
}

// View record details
function viewDetails(record) {
  router.push({
    name: 'entity-detail',
    params: {
      entity: props.entity,
      id: record.id
    }
  })
}

// Handle delete
async function handleDelete(record) {
  if (!confirm(`Are you sure you want to delete this record?`)) {
    return
  }

  try {
    await props.store.delete(record.id)
  } catch (err) {
    console.error('Failed to delete record:', err)
  }
}

// Watch sort changes and reload data
watch([sortField, sortDirection], () => {
  if (sortField.value) {
    props.store.loadRecords({
      sort: sortField.value,
      order: sortDirection.value
    })
  }
})

// Load data on mount
onMounted(() => {
  props.store.loadRecords()
})
</script>
