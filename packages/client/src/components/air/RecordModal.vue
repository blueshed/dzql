<template>
  <dialog ref="modalRef" class="modal">
    <div class="modal-box max-w-2xl">
      <h3 class="font-bold text-lg mb-4">
        {{ isEdit ? 'Edit Record' : 'Add New Record' }}
      </h3>

      <!-- Form fields -->
      <div class="py-4 space-y-4 max-h-96 overflow-y-auto">
        <div
          v-for="field in formFields"
          :key="field.name"
          class="form-control w-full"
        >
          <label class="label">
            <span class="label-text">
              {{ field.label }}
              <span v-if="field.required" class="text-error">*</span>
            </span>
            <span v-if="field.hint" class="label-text-alt text-base-content/60">
              {{ field.hint }}
            </span>
          </label>

          <!-- Text input -->
          <input
            v-if="field.type === 'text'"
            v-model="formData[field.name]"
            type="text"
            :placeholder="field.placeholder"
            :required="field.required"
            class="input input-bordered w-full"
            :class="{ 'input-error': errors[field.name] }"
          />

          <!-- Number input -->
          <input
            v-else-if="field.type === 'number'"
            v-model.number="formData[field.name]"
            type="number"
            :placeholder="field.placeholder"
            :required="field.required"
            class="input input-bordered w-full"
            :class="{ 'input-error': errors[field.name] }"
          />

          <!-- Textarea -->
          <textarea
            v-else-if="field.type === 'textarea'"
            v-model="formData[field.name]"
            :placeholder="field.placeholder"
            :required="field.required"
            :rows="field.rows || 3"
            class="textarea textarea-bordered w-full"
            :class="{ 'textarea-error': errors[field.name] }"
          ></textarea>

          <!-- Boolean/checkbox -->
          <input
            v-else-if="field.type === 'boolean'"
            v-model="formData[field.name]"
            type="checkbox"
            class="checkbox"
          />

          <!-- Date -->
          <input
            v-else-if="field.type === 'date'"
            v-model="formData[field.name]"
            type="date"
            :required="field.required"
            class="input input-bordered w-full"
            :class="{ 'input-error': errors[field.name] }"
          />

          <!-- DateTime -->
          <input
            v-else-if="field.type === 'datetime'"
            v-model="formData[field.name]"
            type="datetime-local"
            :required="field.required"
            class="input input-bordered w-full"
            :class="{ 'input-error': errors[field.name] }"
          />

          <!-- Foreign Key select -->
          <div v-else-if="field.type === 'foreignkey'" class="relative">
            <input
              v-model="foreignKeySearch[field.name]"
              type="text"
              :placeholder="`Search ${field.label}...`"
              class="input input-bordered w-full"
              :class="{ 'input-error': errors[field.name] }"
              @input="handleForeignKeySearch(field)"
              @focus="showForeignKeyDropdown[field.name] = true"
              @blur="() => setTimeout(() => showForeignKeyDropdown[field.name] = false, 200)"
            />

            <!-- Dropdown results -->
            <div
              v-if="showForeignKeyDropdown[field.name] && foreignKeyResults[field.name]?.length > 0"
              class="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
            >
              <button
                v-for="result in foreignKeyResults[field.name]"
                :key="result.id"
                type="button"
                class="w-full px-3 py-2 text-left hover:bg-base-200 transition-colors"
                @mousedown.prevent="selectForeignKey(field.name, result)"
              >
                {{ result.label }}
              </button>
            </div>

            <!-- Selected value display -->
            <div v-if="selectedForeignKeys[field.name]" class="mt-1 text-sm text-base-content/60">
              Selected: {{ selectedForeignKeys[field.name].label }}
            </div>
          </div>

          <!-- JSON editor -->
          <textarea
            v-else-if="field.type === 'json'"
            v-model="formData[field.name]"
            :placeholder="field.placeholder || '{}'"
            :required="field.required"
            :rows="field.rows || 5"
            class="textarea textarea-bordered w-full font-mono text-sm"
            :class="{ 'textarea-error': errors[field.name] }"
          ></textarea>

          <!-- Error message -->
          <label v-if="errors[field.name]" class="label">
            <span class="label-text-alt text-error">{{ errors[field.name] }}</span>
          </label>
        </div>
      </div>

      <!-- Actions -->
      <div class="modal-action">
        <button
          type="button"
          class="btn"
          @click="cancel"
          :disabled="saving"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary"
          @click="save"
          :disabled="saving"
        >
          <span v-if="saving" class="loading loading-spinner loading-sm"></span>
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useEntityStore } from '../../stores/entityFactory'

const props = defineProps({
  entity: {
    type: String,
    required: true
  },
  fields: {
    type: Array,
    required: true
  },
  record: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['saved', 'cancelled'])

const modalRef = ref(null)
const saving = ref(false)
const formData = reactive({})
const errors = reactive({})

// Foreign key handling
const foreignKeySearch = reactive({})
const foreignKeyResults = reactive({})
const showForeignKeyDropdown = reactive({})
const selectedForeignKeys = reactive({})

const isEdit = computed(() => !!props.record)

const formFields = computed(() => {
  return props.fields.map(field => ({
    name: field.name,
    label: field.label || formatFieldName(field.name),
    type: field.type || 'text',
    required: field.required || false,
    placeholder: field.placeholder || '',
    hint: field.hint || '',
    rows: field.rows,
    referencedEntity: field.referencedEntity
  }))
})

// Watch for record changes (when editing)
watch(() => props.record, (newRecord) => {
  if (newRecord) {
    Object.keys(formData).forEach(key => delete formData[key])
    Object.assign(formData, { ...newRecord })

    // Initialize foreign key displays
    formFields.value.forEach(field => {
      if (field.type === 'foreignkey' && newRecord[field.name]) {
        loadForeignKeyLabel(field.name, newRecord[field.name], field.referencedEntity)
      }
    })
  } else {
    resetForm()
  }
}, { immediate: true })

function formatFieldName(name) {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function resetForm() {
  Object.keys(formData).forEach(key => delete formData[key])
  Object.keys(errors).forEach(key => delete errors[key])
  Object.keys(foreignKeySearch).forEach(key => delete foreignKeySearch[key])
  Object.keys(foreignKeyResults).forEach(key => delete foreignKeyResults[key])
  Object.keys(showForeignKeyDropdown).forEach(key => delete showForeignKeyDropdown[key])
  Object.keys(selectedForeignKeys).forEach(key => delete selectedForeignKeys[key])

  // Initialize with default values
  formFields.value.forEach(field => {
    if (field.type === 'boolean') {
      formData[field.name] = false
    } else if (field.type === 'json') {
      formData[field.name] = '{}'
    } else {
      formData[field.name] = null
    }
  })
}

async function loadForeignKeyLabel(fieldName, id, referencedEntity) {
  try {
    const entityStore = useEntityStore(referencedEntity)
    const record = await entityStore.get(id)
    const labelField = getLabelField(referencedEntity, record)
    selectedForeignKeys[fieldName] = {
      id,
      label: record[labelField] || `#${id}`
    }
    foreignKeySearch[fieldName] = selectedForeignKeys[fieldName].label
  } catch (err) {
    console.error('Failed to load foreign key label:', err)
    selectedForeignKeys[fieldName] = { id, label: `#${id}` }
    foreignKeySearch[fieldName] = `#${id}`
  }
}

function getLabelField(entityName, record) {
  // Try common label fields
  const labelCandidates = ['name', 'title', 'label', 'email', 'username', 'code']
  for (const field of labelCandidates) {
    if (record[field]) return field
  }
  // Return first non-id string field
  const stringField = Object.keys(record).find(
    key => key !== 'id' && typeof record[key] === 'string' && record[key]
  )
  return stringField || 'id'
}

async function handleForeignKeySearch(field) {
  const query = foreignKeySearch[field.name]
  if (!query || query.length < 1) {
    foreignKeyResults[field.name] = []
    return
  }

  try {
    const entityStore = useEntityStore(field.referencedEntity)
    const results = await entityStore.lookup(query)
    foreignKeyResults[field.name] = results
    showForeignKeyDropdown[field.name] = true
  } catch (err) {
    console.error('Foreign key search error:', err)
    foreignKeyResults[field.name] = []
  }
}

function selectForeignKey(fieldName, result) {
  selectedForeignKeys[fieldName] = result
  foreignKeySearch[fieldName] = result.label
  formData[fieldName] = result.id
  showForeignKeyDropdown[fieldName] = false
}

function validate() {
  Object.keys(errors).forEach(key => delete errors[key])
  let isValid = true

  formFields.value.forEach(field => {
    if (field.required && !formData[field.name]) {
      errors[field.name] = 'This field is required'
      isValid = false
    }

    // Validate JSON
    if (field.type === 'json' && formData[field.name]) {
      try {
        JSON.parse(formData[field.name])
      } catch (err) {
        errors[field.name] = 'Invalid JSON format'
        isValid = false
      }
    }
  })

  return isValid
}

async function save() {
  if (!validate()) {
    return
  }

  saving.value = true
  try {
    const entityStore = useEntityStore(props.entity)

    // Prepare data
    const dataToSave = { ...formData }

    // Parse JSON fields
    formFields.value.forEach(field => {
      if (field.type === 'json' && dataToSave[field.name]) {
        try {
          dataToSave[field.name] = JSON.parse(dataToSave[field.name])
        } catch (err) {
          // Keep as string if parse fails
        }
      }
    })

    if (isEdit.value) {
      await entityStore.save(dataToSave)
    } else {
      await entityStore.create(dataToSave)
    }

    emit('saved')
    close()
  } catch (err) {
    console.error('Failed to save record:', err)
    errors.general = err.message || 'Failed to save record'
  } finally {
    saving.value = false
  }
}

function cancel() {
  close()
  emit('cancelled')
}

function open() {
  resetForm()
  modalRef.value?.showModal()
}

function close() {
  modalRef.value?.close()
}

defineExpose({ open, close })
</script>
