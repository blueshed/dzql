<template>
  <div class="h-screen w-screen flex flex-col bg-base-200">
    <!-- Login Screen -->
    <div v-if="!isAuthenticated" class="flex-1 flex items-center justify-center">
      <div class="card w-96 bg-base-100 shadow-xl">
        <div class="card-body">
          <h2 class="card-title">DZQL Air</h2>
          <p class="text-sm text-base-content/60">Spreadsheet interface for your data</p>
          <div class="form-control">
            <label class="label">
              <span class="label-text">Email</span>
            </label>
            <input
              v-model="email"
              type="email"
              class="input input-bordered"
              @keydown.enter="login"
            />
          </div>
          <div class="form-control">
            <label class="label">
              <span class="label-text">Password</span>
            </label>
            <input
              v-model="password"
              type="password"
              class="input input-bordered"
              @keydown.enter="login"
            />
          </div>
          <div class="card-actions justify-end mt-4">
            <button class="btn btn-primary" @click="login" :disabled="loading">
              <span v-if="loading" class="loading loading-spinner loading-sm"></span>
              <span v-else>Login</span>
            </button>
          </div>
          <div v-if="error" class="alert alert-error mt-4">
            <span>{{ error }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Spreadsheet View -->
    <div v-else class="flex-1 overflow-hidden">
      <!-- Loading state -->
      <div v-if="loading" class="flex items-center justify-center h-full">
        <span class="loading loading-spinner loading-lg"></span>
      </div>

      <!-- No entities -->
      <div v-else-if="!entities || entities.length === 0" class="flex items-center justify-center h-full">
        <div class="text-center">
          <p class="text-lg font-semibold mb-2">No entities found</p>
          <p class="text-sm text-base-content/60">Register entities in your database</p>
        </div>
      </div>

      <!-- Spreadsheet -->
      <div v-else class="h-full w-full overflow-auto">
        <table class="table table-pin-rows table-pin-cols table-xs">
          <thead>
            <tr>
              <!-- Top-left corner: Entity selector -->
              <th class="bg-base-300 z-20">
                <select
                  v-model="selectedEntity"
                  class="select select-bordered select-xs w-full max-w-xs"
                  @change="handleEntityChange"
                >
                  <option disabled :value="null">Select entity...</option>
                  <option v-for="entity in entities" :key="entity" :value="entity">
                    {{ formatEntityName(entity) }}
                  </option>
                </select>
              </th>

              <!-- Column headers -->
              <th
                v-for="column in visibleColumns"
                :key="column.column_name"
                class="bg-base-200"
              >
                <div class="flex items-center gap-2">
                  <span>{{ formatColumnName(column.column_name) }}</span>
                  <span v-if="!column.is_nullable" class="text-error text-xs">*</span>
                </div>
              </th>

              <!-- Actions column -->
              <th class="bg-base-200">Actions</th>
            </tr>
          </thead>
          <tbody v-if="selectedEntity">
            <!-- Loading records -->
            <tr v-if="recordsLoading">
              <td colspan="999" class="text-center py-8">
                <span class="loading loading-spinner loading-md"></span>
              </td>
            </tr>

            <!-- No records -->
            <tr v-else-if="!records || records.length === 0">
              <td colspan="999" class="text-center py-8 text-base-content/60">
                No records found
              </td>
            </tr>

            <!-- Data rows -->
            <tr
              v-else
              v-for="record in records"
              :key="record.id"
              class="hover:bg-base-200/50"
            >
              <!-- Row header: Primary key (read-only, no edit) -->
              <th class="bg-base-300 font-mono text-sm text-base-content/60">
                {{ record.id }}
              </th>

              <!-- Data cells -->
              <td
                v-for="column in visibleColumns"
                :key="`${record.id}-${column.column_name}`"
                class="p-0"
              >
                <component
                  :is="getCellComponent(column)"
                  v-model="record[column.column_name]"
                  v-bind="getCellProps(column)"
                  @save="(value) => handleCellSave(record, column.column_name, value)"
                />
              </td>

              <!-- Actions -->
              <td class="p-2">
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
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, markRaw, onMounted } from 'vue'
import { useWsStore } from 'dzql/client/stores'
import { useMetaStore } from '../stores/meta'
import { useEntityStore } from '../stores/entityFactory'
import { getCellType } from './cells/CellFactory'

// Import cell components
import TextCell from './cells/TextCell.vue'
import NumberCell from './cells/NumberCell.vue'
import BooleanCell from './cells/BooleanCell.vue'
import DateCell from './cells/DateCell.vue'
import ForeignKeyCell from './cells/ForeignKeyCell.vue'
import CoordinateCell from './cells/CoordinateCell.vue'
import JSONCell from './cells/JSONCell.vue'
import TextAreaCell from './cells/TextAreaCell.vue'

// Component registry
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

const wsStore = useWsStore()
const metaStore = useMetaStore()

// Auth state
const email = ref('test@example.com')
const password = ref('password123')
const loading = ref(false)
const error = ref(null)
const isAuthenticated = ref(false)

// Spreadsheet state
const selectedEntity = ref(null)
const recordsLoading = ref(false)

// Computed
const entities = computed(() => Object.keys(metaStore.entities))
const metadata = computed(() => selectedEntity.value ? metaStore.entities[selectedEntity.value] : null)
const columns = computed(() => metadata.value?.columns || [])
const relations = computed(() => metadata.value?.relations || [])

// Visible columns (exclude id since it's the row header)
const visibleColumns = computed(() => {
  return columns.value.filter(col => {
    if (col.column_name === 'id') return false
    if (['created_at', 'updated_at', 'deleted_at'].includes(col.column_name)) return false
    return true
  })
})

// Entity store
const entityStore = computed(() => {
  return selectedEntity.value ? useEntityStore(selectedEntity.value) : null
})

const records = computed(() => entityStore.value?.records || [])

// Login
async function login() {
  loading.value = true
  error.value = null

  try {
    // Connect to WebSocket
    await wsStore.connect('ws://localhost:3000/ws')

    // Login with proper format
    await wsStore.login({ email: email.value, password: password.value })

    // Fetch metadata
    await metaStore.fetchMetadata()

    isAuthenticated.value = true
  } catch (err) {
    console.error('Login failed:', err)
    error.value = err.message || 'Login failed'
  } finally {
    loading.value = false
  }
}

// Handle entity change
async function handleEntityChange() {
  if (!selectedEntity.value) return

  recordsLoading.value = true
  try {
    await entityStore.value.search()
  } catch (err) {
    console.error('Failed to load records:', err)
  } finally {
    recordsLoading.value = false
  }
}

// Get cell component
function getCellComponent(column) {
  const cellType = getCellType(column, relations.value, selectedEntity.value)
  return cellComponents[cellType.component] || cellComponents.TextCell
}

// Get cell props
function getCellProps(column) {
  const cellType = getCellType(column, relations.value, selectedEntity.value)
  const props = {
    columnName: column.column_name
  }

  if (cellType.type === 'foreign-key') {
    props.referencedEntity = cellType.referencedEntity
  }

  return props
}

// Format names
function formatEntityName(name) {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatColumnName(name) {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Handle cell save
async function handleCellSave(record, columnName, value) {
  try {
    await entityStore.value.save({
      ...record,
      [columnName]: value
    })
  } catch (err) {
    console.error('Failed to save cell:', err)
    error.value = err.message || 'Failed to save'
  }
}

// Handle delete
async function handleDelete(record) {
  if (!confirm('Are you sure you want to delete this record?')) return

  try {
    await entityStore.value.delete(record.id)
  } catch (err) {
    console.error('Failed to delete:', err)
    error.value = err.message || 'Failed to delete'
  }
}
</script>
