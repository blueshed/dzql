<template>
  <div class="drawer drawer-end z-40">
    <input
      :id="drawerId"
      type="checkbox"
      class="drawer-toggle"
      v-model="isOpen"
    />
    <div class="drawer-side">
      <label :for="drawerId" class="drawer-overlay"></label>
      <div class="bg-base-100 min-h-full w-[500px] p-6">
        <!-- Header -->
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-2xl font-bold">Filters</h2>
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

        <!-- Filter conditions -->
        <div class="space-y-4 mb-6">
          <div
            v-for="(filter, index) in filters"
            :key="index"
            class="card bg-base-200 shadow-sm"
          >
            <div class="card-body p-4 space-y-3">
              <!-- Field selector -->
              <select
                v-model="filter.field"
                class="select select-bordered select-sm w-full"
                @change="handleFieldChange(index)"
              >
                <option value="">Select field...</option>
                <option v-for="col in columns" :key="col.name" :value="col.name">
                  {{ col.label }}
                </option>
              </select>

              <!-- Operator selector -->
              <select
                v-if="filter.field"
                v-model="filter.operator"
                class="select select-bordered select-sm w-full"
              >
                <option
                  v-for="op in getOperatorsForField(filter.field)"
                  :key="op.value"
                  :value="op.value"
                >
                  {{ op.label }}
                </option>
              </select>

              <!-- Value input -->
              <div v-if="filter.field && filter.operator && !isUnaryOperator(filter.operator)">
                <!-- Text input -->
                <input
                  v-if="getFieldType(filter.field) === 'text'"
                  v-model="filter.value"
                  type="text"
                  placeholder="Enter value..."
                  class="input input-bordered input-sm w-full"
                />

                <!-- Number input -->
                <input
                  v-else-if="getFieldType(filter.field) === 'number'"
                  v-model.number="filter.value"
                  type="number"
                  placeholder="Enter number..."
                  class="input input-bordered input-sm w-full"
                />

                <!-- Date input -->
                <input
                  v-else-if="getFieldType(filter.field) === 'date'"
                  v-model="filter.value"
                  type="date"
                  class="input input-bordered input-sm w-full"
                />

                <!-- Boolean select -->
                <select
                  v-else-if="getFieldType(filter.field) === 'boolean'"
                  v-model="filter.value"
                  class="select select-bordered select-sm w-full"
                >
                  <option value="true">True</option>
                  <option value="false">False</option>
                </select>
              </div>

              <!-- AND/OR toggle (not for first filter) -->
              <div v-if="index > 0" class="flex items-center gap-2">
                <span class="text-sm text-base-content/60">Combine with:</span>
                <div class="join">
                  <input
                    class="join-item btn btn-xs"
                    type="radio"
                    :name="`logic-${index}`"
                    aria-label="AND"
                    :value="'AND'"
                    v-model="filter.logic"
                  />
                  <input
                    class="join-item btn btn-xs"
                    type="radio"
                    :name="`logic-${index}`"
                    aria-label="OR"
                    :value="'OR'"
                    v-model="filter.logic"
                  />
                </div>
              </div>

              <!-- Remove button -->
              <button
                type="button"
                class="btn btn-sm btn-ghost btn-error w-full"
                @click="removeFilter(index)"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Remove filter
              </button>
            </div>
          </div>

          <!-- No filters message -->
          <div v-if="filters.length === 0" class="text-center py-8 text-base-content/60">
            <svg class="w-12 h-12 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <p>No filters applied</p>
            <p class="text-sm">Click "Add Filter" to get started</p>
          </div>
        </div>

        <!-- Actions -->
        <div class="space-y-2">
          <button
            type="button"
            class="btn btn-sm btn-outline w-full gap-1"
            @click="addFilter"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add Filter
          </button>

          <div class="divider my-2"></div>

          <button
            type="button"
            class="btn btn-sm btn-primary w-full"
            @click="applyFilters"
            :disabled="filters.length === 0"
          >
            Apply Filters
          </button>

          <button
            type="button"
            class="btn btn-sm btn-ghost w-full"
            @click="clearFilters"
            :disabled="filters.length === 0"
          >
            Clear All
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  columns: {
    type: Array,
    default: () => []
  },
  modelValue: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'apply', 'clear'])

const drawerId = 'filter-drawer'
const isOpen = ref(props.modelValue)
const filters = ref([])

// Watch for external changes
watch(() => props.modelValue, (val) => {
  isOpen.value = val
})

// Emit changes
watch(isOpen, (val) => {
  emit('update:modelValue', val)
})

// Operators by field type
const operators = {
  text: [
    { value: 'contains', label: 'Contains' },
    { value: 'not_contains', label: 'Does not contain' },
    { value: 'equals', label: 'Equals' },
    { value: 'not_equals', label: 'Not equals' },
    { value: 'starts_with', label: 'Starts with' },
    { value: 'ends_with', label: 'Ends with' },
    { value: 'is_empty', label: 'Is empty' },
    { value: 'is_not_empty', label: 'Is not empty' }
  ],
  number: [
    { value: 'equals', label: '=' },
    { value: 'not_equals', label: '!=' },
    { value: 'greater_than', label: '>' },
    { value: 'greater_than_or_equal', label: '>=' },
    { value: 'less_than', label: '<' },
    { value: 'less_than_or_equal', label: '<=' },
    { value: 'is_empty', label: 'Is empty' },
    { value: 'is_not_empty', label: 'Is not empty' }
  ],
  boolean: [
    { value: 'is_true', label: 'Is true' },
    { value: 'is_false', label: 'Is false' },
    { value: 'is_empty', label: 'Is empty' }
  ],
  date: [
    { value: 'equals', label: 'Is' },
    { value: 'before', label: 'Is before' },
    { value: 'after', label: 'Is after' },
    { value: 'is_empty', label: 'Is empty' },
    { value: 'is_not_empty', label: 'Is not empty' }
  ],
  foreignkey: [
    { value: 'equals', label: 'Is' },
    { value: 'not_equals', label: 'Is not' },
    { value: 'is_empty', label: 'Is empty' },
    { value: 'is_not_empty', label: 'Is not empty' }
  ]
}

function getFieldType(fieldName) {
  const column = props.columns.find(col => col.name === fieldName)
  if (!column) return 'text'

  if (column.isForeignKey) return 'foreignkey'
  if (column.dataType === 'number') return 'number'
  if (column.dataType === 'boolean') return 'boolean'
  if (column.name.includes('date')) return 'date'

  return 'text'
}

function getOperatorsForField(fieldName) {
  const type = getFieldType(fieldName)
  return operators[type] || operators.text
}

function isUnaryOperator(operator) {
  return ['is_empty', 'is_not_empty', 'is_true', 'is_false'].includes(operator)
}

function addFilter() {
  filters.value.push({
    field: '',
    operator: '',
    value: null,
    logic: 'AND'
  })
}

function removeFilter(index) {
  filters.value.splice(index, 1)
}

function handleFieldChange(index) {
  const filter = filters.value[index]
  // Reset operator and value when field changes
  filter.operator = ''
  filter.value = null

  // Set default operator based on type
  const ops = getOperatorsForField(filter.field)
  if (ops.length > 0) {
    filter.operator = ops[0].value
  }
}

function applyFilters() {
  // Validate filters
  const validFilters = filters.value.filter(f => {
    if (!f.field || !f.operator) return false
    if (!isUnaryOperator(f.operator) && (f.value === null || f.value === '')) {
      return false
    }
    return true
  })

  emit('apply', validFilters)
  close()
}

function clearFilters() {
  filters.value = []
  emit('clear')
  close()
}

function close() {
  isOpen.value = false
}

function open() {
  isOpen.value = true
}

defineExpose({ open, close })
</script>
