<template>
  <div class="drawer drawer-end z-30">
    <input
      :id="drawerId"
      type="checkbox"
      class="drawer-toggle"
      v-model="isOpen"
    />
    <div class="drawer-side">
      <label :for="drawerId" class="drawer-overlay"></label>
      <div class="bg-base-100 min-h-full w-[600px] p-6 flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold">Record Details</h2>
            <p class="text-sm text-base-content/60">ID: {{ record?.id }}</p>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-ghost btn-circle"
            @click="close"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- Content -->
        <div v-if="record" class="flex-1 overflow-y-auto space-y-6">
          <!-- Basic Fields -->
          <div class="card bg-base-200 shadow-sm">
            <div class="card-body p-4">
              <h3 class="card-title text-lg mb-4">Fields</h3>
              <div class="space-y-4">
                <div
                  v-for="field in scalarFields"
                  :key="field.name"
                  class="form-control"
                >
                  <label class="label">
                    <span class="label-text font-semibold">{{ field.label }}</span>
                    <span v-if="field.required" class="label-text-alt text-error">Required</span>
                  </label>

                  <!-- Display different field types -->
                  <div class="px-3 py-2 bg-base-100 rounded border border-base-300">
                    <!-- Foreign Key -->
                    <div v-if="field.type === 'foreignkey'" class="flex items-center justify-between">
                      <span>{{ formatValue(record[field.name]) }}</span>
                      <button
                        v-if="record[field.name]"
                        type="button"
                        class="btn btn-xs btn-ghost"
                        @click="navigateToRelated(field.referencedEntity, getIdFromValue(record[field.name]))"
                        title="Open related record"
                      >
                        →
                      </button>
                    </div>

                    <!-- Boolean -->
                    <div v-else-if="field.type === 'boolean'" class="flex items-center gap-2">
                      <input
                        type="checkbox"
                        :checked="record[field.name]"
                        disabled
                        class="checkbox checkbox-sm"
                      />
                      <span>{{ record[field.name] ? 'Yes' : 'No' }}</span>
                    </div>

                    <!-- JSON -->
                    <pre v-else-if="field.type === 'json'" class="text-xs overflow-x-auto">{{ formatJSON(record[field.name]) }}</pre>

                    <!-- Default -->
                    <span v-else>{{ formatValue(record[field.name]) }}</span>
                  </div>
                </div>
              </div>

              <!-- Edit button -->
              <div class="card-actions justify-end mt-4">
                <button
                  type="button"
                  class="btn btn-sm btn-primary"
                  @click="editRecord"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit Record
                </button>
              </div>
            </div>
          </div>

          <!-- Related Records (One-to-Many) -->
          <div
            v-for="relation in relatedFields"
            :key="relation.name"
            class="card bg-base-200 shadow-sm"
          >
            <div class="card-body p-4">
              <h3 class="card-title text-lg mb-4">
                {{ relation.label }}
                <div class="badge badge-primary badge-sm">
                  {{ relation.records?.length || 0 }}
                </div>
              </h3>

              <!-- Related records list -->
              <div v-if="relation.records && relation.records.length > 0" class="space-y-2">
                <div
                  v-for="relatedRecord in relation.records"
                  :key="relatedRecord.id"
                  class="flex items-center justify-between p-3 bg-base-100 rounded border border-base-300 hover:border-primary transition-colors cursor-pointer"
                  @click="navigateToRelated(relation.entity, relatedRecord.id)"
                >
                  <div class="flex-1">
                    <div class="font-semibold">{{ getRecordLabel(relatedRecord) }}</div>
                    <div class="text-xs text-base-content/60">ID: {{ relatedRecord.id }}</div>
                  </div>
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost"
                    title="Open record"
                  >
                    →
                  </button>
                </div>
              </div>

              <!-- Empty state -->
              <div v-else class="text-center py-8 text-base-content/60">
                <p class="text-sm">No related {{ relation.label.toLowerCase() }} found</p>
              </div>
            </div>
          </div>

          <!-- Metadata -->
          <div class="card bg-base-200 shadow-sm">
            <div class="card-body p-4">
              <h3 class="card-title text-lg mb-4">Metadata</h3>
              <div class="space-y-2 text-sm">
                <div v-if="record.created_at" class="flex justify-between">
                  <span class="text-base-content/60">Created:</span>
                  <span>{{ formatDate(record.created_at) }}</span>
                </div>
                <div v-if="record.updated_at" class="flex justify-between">
                  <span class="text-base-content/60">Updated:</span>
                  <span>{{ formatDate(record.updated_at) }}</span>
                </div>
                <div v-if="record.deleted_at" class="flex justify-between">
                  <span class="text-base-content/60 text-error">Deleted:</span>
                  <span class="text-error">{{ formatDate(record.deleted_at) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex gap-2 mt-6 pt-4 border-t border-base-300">
          <button
            type="button"
            class="btn btn-error btn-sm flex-1"
            @click="deleteRecord"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            @click="close"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  record: {
    type: Object,
    default: null
  },
  fields: {
    type: Array,
    default: () => []
  },
  modelValue: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'edit', 'delete', 'navigate'])

const drawerId = 'record-details-drawer'
const isOpen = ref(props.modelValue)

// Watch for external changes
watch(() => props.modelValue, (val) => {
  isOpen.value = val
})

// Emit changes
watch(isOpen, (val) => {
  emit('update:modelValue', val)
})

// Separate scalar fields from array fields
const scalarFields = computed(() => {
  if (!props.record) return []

  return props.fields.filter(field => {
    const value = props.record[field.name]
    return !Array.isArray(value) && field.name !== 'id'
  })
})

const relatedFields = computed(() => {
  if (!props.record) return []

  return Object.keys(props.record)
    .filter(key => {
      const value = props.record[key]
      return Array.isArray(value) && value.length >= 0
    })
    .map(key => ({
      name: key,
      label: formatFieldName(key),
      entity: key, // Assume the field name is the entity name
      records: props.record[key]
    }))
})

function formatFieldName(name) {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatValue(value) {
  if (value == null || value === undefined) {
    return '—'
  }

  // Handle objects (like expanded foreign keys)
  if (typeof value === 'object' && value.id) {
    // Try to find a label field
    const labelFields = ['name', 'title', 'label', 'email', 'username']
    for (const field of labelFields) {
      if (value[field]) {
        return `${value[field]} (#${value.id})`
      }
    }
    return `#${value.id}`
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  if (value instanceof Date) {
    return formatDate(value)
  }

  return String(value)
}

function formatJSON(value) {
  if (!value) return '{}'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  try {
    const date = new Date(dateStr)
    return date.toLocaleString()
  } catch {
    return String(dateStr)
  }
}

function getIdFromValue(value) {
  if (typeof value === 'object' && value?.id) {
    return value.id
  }
  return value
}

function getRecordLabel(record) {
  const labelFields = ['name', 'title', 'label', 'email', 'username', 'code']
  for (const field of labelFields) {
    if (record[field]) {
      return record[field]
    }
  }
  // Return first string field that's not id
  const stringField = Object.keys(record).find(
    key => key !== 'id' && typeof record[key] === 'string' && record[key]
  )
  return stringField ? record[stringField] : `Record #${record.id}`
}

function editRecord() {
  emit('edit', props.record)
}

function deleteRecord() {
  if (confirm('Are you sure you want to delete this record?')) {
    emit('delete', props.record)
    close()
  }
}

function navigateToRelated(entity, id) {
  emit('navigate', entity, id)
}

function close() {
  isOpen.value = false
}

function open() {
  isOpen.value = true
}

defineExpose({ open, close })
</script>
