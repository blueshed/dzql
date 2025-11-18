<template>
  <div class="group relative">
    <!-- Display mode: show formatted JSON with expand icon -->
    <div
      v-if="!showModal"
      class="px-3 py-2 cursor-pointer hover:bg-base-200 rounded transition-colors flex items-center gap-2"
      @click="openModal"
    >
      <span class="font-mono text-sm truncate">
        {{ displayValue }}
      </span>
      <svg class="w-4 h-4 opacity-0 group-hover:opacity-100 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </div>

    <!-- Modal with JSON editor -->
    <dialog ref="modalRef" class="modal" :class="{ 'modal-open': showModal }">
      <div class="modal-box w-11/12 max-w-4xl">
        <h3 class="font-bold text-lg mb-4">Edit JSON</h3>

        <!-- JSON editor -->
        <div class="form-control mb-4">
          <textarea
            v-model="editValue"
            class="textarea textarea-bordered font-mono text-sm h-96"
            :class="{ 'textarea-error': validationError }"
            placeholder="{}"
            @input="validateJSON"
          ></textarea>
          <label v-if="validationError" class="label">
            <span class="label-text-alt text-error">{{ validationError }}</span>
          </label>
          <label v-else class="label">
            <span class="label-text-alt">Enter valid JSON</span>
          </label>
        </div>

        <!-- Format button -->
        <div class="mb-4">
          <button
            type="button"
            class="btn btn-sm btn-ghost gap-2"
            :disabled="!!validationError"
            @click="formatJSON"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            Format
          </button>
        </div>

        <!-- Actions -->
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" @click="handleCancel">
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!!validationError"
            @click="handleSave"
          >
            Save
          </button>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop" @click="handleCancel">
        <button type="button">close</button>
      </form>
    </dialog>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  modelValue: {
    type: [Object, Array, String],
    default: null
  },
  readonly: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'save'])

const showModal = ref(false)
const editValue = ref('')
const modalRef = ref(null)
const validationError = ref('')

const displayValue = computed(() => {
  if (!props.modelValue) return '{}'
  try {
    const str = typeof props.modelValue === 'string'
      ? props.modelValue
      : JSON.stringify(props.modelValue)
    return str.length > 50 ? str.substring(0, 50) + '...' : str
  } catch {
    return '{}'
  }
})

watch(() => props.modelValue, (newVal) => {
  try {
    editValue.value = typeof newVal === 'string'
      ? newVal
      : JSON.stringify(newVal, null, 2)
  } catch {
    editValue.value = '{}'
  }
}, { immediate: true })

function openModal() {
  if (props.readonly) return
  showModal.value = true
  try {
    editValue.value = typeof props.modelValue === 'string'
      ? props.modelValue
      : JSON.stringify(props.modelValue, null, 2)
  } catch {
    editValue.value = '{}'
  }
  validationError.value = ''
}

function validateJSON() {
  try {
    if (editValue.value.trim()) {
      JSON.parse(editValue.value)
    }
    validationError.value = ''
  } catch (err) {
    validationError.value = err.message
  }
}

function formatJSON() {
  try {
    const parsed = JSON.parse(editValue.value)
    editValue.value = JSON.stringify(parsed, null, 2)
    validationError.value = ''
  } catch (err) {
    validationError.value = err.message
  }
}

function handleSave() {
  if (validationError.value) return

  showModal.value = false
  try {
    const parsed = editValue.value.trim() ? JSON.parse(editValue.value) : null
    emit('update:modelValue', parsed)
    emit('save', parsed)
  } catch (err) {
    console.error('JSON save error:', err)
  }
}

function handleCancel() {
  showModal.value = false
  try {
    editValue.value = typeof props.modelValue === 'string'
      ? props.modelValue
      : JSON.stringify(props.modelValue, null, 2)
  } catch {
    editValue.value = '{}'
  }
  validationError.value = ''
}
</script>
