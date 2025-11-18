<template>
  <div class="h-screen w-screen flex flex-col bg-base-200">
    <div class="flex-1 overflow-hidden">
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
              <!-- Top-left corner: Entity selector dropdown -->
              <th class="bg-base-300 z-20 w-16">
                <div class="dropdown dropdown-right">
                  <button
                    tabindex="0"
                    class="btn btn-ghost btn-xs"
                    title="Select entity"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                  <ul tabindex="0" class="dropdown-content z-50 menu p-2 shadow-lg bg-base-100 rounded-box w-52 max-h-96 overflow-y-auto">
                    <li v-for="entity in entities" :key="entity">
                      <a
                        @click="selectEntity(entity)"
                        :class="{ 'active': entity === selectedEntity }"
                      >
                        {{ formatEntityName(entity) }}
                      </a>
                    </li>
                  </ul>
                </div>
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
              <th class="bg-base-300 font-mono text-xs text-base-content/60 w-16 text-center">
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
                  :model-value="getCellValue(record, column)"
                  v-bind="getCellProps(column)"
                  @update:model-value="(value) => handleCellUpdate(record, column.column_name, value)"
                  @save="(value) => handleCellSave(record, column.column_name, value)"
                  @navigate="(entity, id) => handleNavigate(entity, id)"
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
import { ref, computed, watch, markRaw } from 'vue'
import { useRouter, useRoute } from 'vue-router'
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

const router = useRouter()
const route = useRoute()
const metaStore = useMetaStore()

const loading = ref(false)

// Spreadsheet state
const selectedEntity = ref(null)
const recordsLoading = ref(false)

// Computed
const entities = computed(() => Object.keys(metaStore.entities))

// Get columns from actual records (like DynamicTable does)
const visibleColumns = computed(() => {
  if (!records.value || records.value.length === 0) return []

  const firstRecord = records.value[0]
  if (!firstRecord) return []

  // Get foreign key info
  const fkFields = metaStore.getForeignKeyFields(selectedEntity.value)

  return Object.keys(firstRecord)
    .filter(key => {
      if (key === 'id') return false
      if (['created_at', 'updated_at', 'deleted_at'].includes(key)) return false
      const value = firstRecord[key]
      // Skip arrays (one-to-many relationships - not editable in this view)
      if (Array.isArray(value)) return false
      return true
    })
    .map(key => {
      const value = firstRecord[key]
      const fk = fkFields.find(f => f.column === key)

      // Only treat as foreign key if we have metadata for it
      // (expanded objects without metadata are treated as regular cells)
      const isFK = !!fk
      const refEntity = fk?.referencedEntity || null

      return {
        column_name: key,
        data_type: typeof value,
        is_nullable: value === null,
        isForeignKey: isFK,
        referencedEntity: refEntity
      }
    })
})

// Entity store
const entityStore = computed(() => {
  return selectedEntity.value ? useEntityStore(selectedEntity.value) : null
})

const records = computed(() => entityStore.value?.records || [])

// Watch route changes to update selected entity
// Component only mounts when state === 'ready', so websocket is connected
watch(() => route.params.entity, async (newEntity) => {
  if (!newEntity) {
    // No entity in route - auto-select first entity
    const firstEntity = Object.keys(metaStore.entities)[0]
    if (firstEntity) {
      router.push({ name: 'entity', params: { entity: firstEntity } })
    }
    return
  }

  if (newEntity === selectedEntity.value) return

  selectedEntity.value = newEntity
  await handleEntityChange()
}, { immediate: true })

// Select entity from dropdown
async function selectEntity(entity) {
  // Update route instead of directly changing state
  router.push({ name: 'entity', params: { entity } })
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
  // If it's already marked as a foreign key, use ForeignKeyCell
  if (column.isForeignKey) {
    return cellComponents.ForeignKeyCell
  }

  const cellType = getCellType(column, [], selectedEntity.value)
  return cellComponents[cellType.component] || cellComponents.TextCell
}

// Get cell value - handle expanded foreign keys
function getCellValue(record, column) {
  const value = record[column.column_name]

  // If value is an object with an id (expanded foreign key), extract the ID
  if (value && typeof value === 'object' && 'id' in value) {
    return value.id
  }

  return value
}

// Handle cell update
function handleCellUpdate(record, columnName, value) {
  record[columnName] = value
}

// Get cell props
function getCellProps(column) {
  const props = {
    columnName: column.column_name
  }

  if (column.isForeignKey) {
    props.referencedEntity = column.referencedEntity
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
  }
}

// Handle delete
async function handleDelete(record) {
  if (!confirm('Are you sure you want to delete this record?')) return

  try {
    await entityStore.value.delete(record.id)
  } catch (err) {
    console.error('Failed to delete:', err)
  }
}

// Handle navigation from foreign key cells
async function handleNavigate(entity, id) {
  // Navigate using router - this will trigger the route watcher
  router.push({ name: 'entity-record', params: { entity, id } })
}
</script>
