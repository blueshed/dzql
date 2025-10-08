<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="p-4 border-b border-base-300 bg-base-100">
      <h2 class="font-semibold text-base-content">
        {{ isNew ? 'Create' : 'Edit' }} {{ formatEntityName(entity) }}
      </h2>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex-1 p-4">
      <div class="alert alert-error">
        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>{{ error }}</span>
      </div>
    </div>

    <!-- Form -->
    <form v-else-if="schema.length > 0" @submit.prevent="handleSave" class="flex-1 overflow-auto">
      <div class="p-4 space-y-4">
        <div v-for="field in editableFields" :key="field.column_name" class="form-control">
          <label class="label">
            <span class="label-text font-medium">
              {{ formatLabel(field.column_name) }}
              <span v-if="!field.is_nullable" class="text-error">*</span>
            </span>
            <span class="label-text-alt text-base-content/60">{{ field.data_type }}</span>
          </label>

          <!-- Foreign Key Select -->
          <select
            v-if="isForeignKey(field)"
            v-model="formData[field.column_name]"
            class="select select-bordered w-full"
            :required="!field.is_nullable"
          >
            <option :value="null">Select {{ formatLabel(field.column_name) }}</option>
            <option
              v-for="option in lookupOptions[field.column_name]"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>

          <!-- Boolean Checkbox -->
          <input
            v-else-if="isBooleanField(field)"
            type="checkbox"
            v-model="formData[field.column_name]"
            class="checkbox checkbox-primary"
          />

          <!-- Number Input -->
          <input
            v-else-if="isNumberField(field)"
            type="number"
            v-model="formData[field.column_name]"
            class="input input-bordered w-full"
            :required="!field.is_nullable"
            :step="field.data_type === 'numeric' ? '0.01' : '1'"
          />

          <!-- Date Input -->
          <input
            v-else-if="isDateField(field)"
            type="date"
            v-model="formData[field.column_name]"
            class="input input-bordered w-full"
            :required="!field.is_nullable"
          />

          <!-- Datetime Input -->
          <input
            v-else-if="isDatetimeField(field)"
            type="datetime-local"
            v-model="formData[field.column_name]"
            class="input input-bordered w-full"
            :required="!field.is_nullable"
          />

          <!-- Textarea for long text -->
          <textarea
            v-else-if="isTextArea(field)"
            v-model="formData[field.column_name]"
            class="textarea textarea-bordered w-full"
            :required="!field.is_nullable"
            rows="4"
          ></textarea>

          <!-- Regular Text Input -->
          <input
            v-else
            type="text"
            v-model="formData[field.column_name]"
            class="input input-bordered w-full"
            :required="!field.is_nullable"
            :maxlength="field.character_maximum_length"
          />

          <!-- Field hint/default -->
          <label v-if="field.column_default" class="label">
            <span class="label-text-alt text-base-content/50">
              Default: {{ field.column_default }}
            </span>
          </label>
        </div>
      </div>
    </form>

    <!-- Empty State -->
    <div v-else class="flex-1 flex items-center justify-center p-4">
      <div class="text-center text-base-content/60">
        <p>Select an item to view properties</p>
      </div>
    </div>

    <!-- Actions -->
    <div v-if="entity && schema.length > 0" class="p-4 border-t border-base-300 flex gap-2 bg-base-100">
      <button
        type="button"
        @click="handleSave"
        class="btn btn-primary flex-1"
        :disabled="saving"
      >
        <span v-if="saving" class="loading loading-spinner loading-sm"></span>
        <span v-else>Save</span>
      </button>
      <button
        type="button"
        @click="handleCancel"
        class="btn flex-1"
        :disabled="saving"
      >
        Cancel
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useMetaStore } from '../stores/meta'
import { useEntityStore } from '../stores/entityFactory'

const router = useRouter()
const route = useRoute()
const metaStore = useMetaStore()

const props = defineProps({
  entity: {
    type: String,
    default: null
  },
  id: {
    type: [String, Number],
    default: null
  }
})

// State
const formData = ref({})
const lookupOptions = ref({})
const loading = ref(false)
const saving = ref(false)
const error = ref(null)

// Computed
const isNew = computed(() => {
  return props.id === 'new' || !props.id
})

const store = computed(() => {
  return props.entity ? useEntityStore(props.entity) : null
})

const schema = computed(() => {
  return props.entity ? metaStore.getEntitySchema(props.entity) : []
})

const editableFields = computed(() => {
  // Exclude id and auto-generated fields
  return schema.value.filter(field => {
    const isId = field.column_name === 'id'
    const isAutoIncrement = field.column_default && field.column_default.includes('nextval')
    return !isId && !isAutoIncrement
  })
})

// Field type checks
const isForeignKey = (field) => {
  const fkFields = metaStore.getForeignKeyFields(props.entity)
  return fkFields.some(fk => fk.column === field.column_name)
}

const isBooleanField = (field) => {
  return field.data_type === 'boolean'
}

const isNumberField = (field) => {
  return ['integer', 'bigint', 'smallint', 'numeric', 'decimal', 'real', 'double precision'].includes(field.data_type)
}

const isDateField = (field) => {
  return field.data_type === 'date'
}

const isDatetimeField = (field) => {
  return ['timestamp', 'timestamp without time zone', 'timestamp with time zone', 'timestamptz'].includes(field.data_type)
}

const isTextArea = (field) => {
  return field.data_type === 'text' || (field.data_type === 'character varying' && (!field.character_maximum_length || field.character_maximum_length > 255))
}

// Format helpers
const formatEntityName = (name) => {
  if (!name) return ''
  return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

const formatLabel = (name) => {
  return name.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// Load record data
const loadRecord = async () => {
  if (isNew.value || !props.id || !store.value) {
    // Initialize empty form
    formData.value = {}
    return
  }

  loading.value = true
  error.value = null

  try {
    const record = await store.value.get(props.id)
    formData.value = { ...record }
  } catch (err) {
    console.error('Failed to load record:', err)
    error.value = err.message || 'Failed to load record'
  } finally {
    loading.value = false
  }
}

// Load lookup options for foreign keys
const loadLookupOptions = async () => {
  if (!props.entity) return

  const fkFields = metaStore.getForeignKeyFields(props.entity)

  for (const fk of fkFields) {
    try {
      const fkStore = useEntityStore(fk.referencedEntity)
      const options = await fkStore.lookup('')
      lookupOptions.value[fk.column] = options || []
    } catch (err) {
      console.error(`Failed to load lookup options for ${fk.column}:`, err)
      lookupOptions.value[fk.column] = []
    }
  }
}

// Handle save
const handleSave = async () => {
  if (!store.value) return

  saving.value = true
  error.value = null

  try {
    const dataToSave = { ...formData.value }

    // Add id if updating
    if (!isNew.value) {
      dataToSave.id = props.id
    }

    await store.value.save(dataToSave)

    // Navigate back to list
    router.push(`/${props.entity}`)
  } catch (err) {
    console.error('Save failed:', err)
    error.value = err.message || 'Failed to save'
  } finally {
    saving.value = false
  }
}

// Handle cancel
const handleCancel = () => {
  router.push(`/${props.entity}`)
}

// Watch for route changes
watch(() => [props.entity, props.id], () => {
  loadRecord()
  loadLookupOptions()
}, { immediate: true })
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
