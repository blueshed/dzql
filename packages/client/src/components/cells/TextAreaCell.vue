<template>
  <div class="group relative">
    <!-- Display mode: show truncated text with expand icon -->
    <div
      v-if="!showModal"
      class="px-3 py-2 cursor-pointer hover:bg-base-200 rounded transition-colors flex items-center gap-2"
      @click="openModal"
    >
      <span class="truncate">
        {{ displayValue || '—' }}
      </span>
      <svg class="w-4 h-4 opacity-0 group-hover:opacity-100 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
      </svg>
    </div>

    <!-- Modal with textarea editor -->
    <dialog ref="modalRef" class="modal" :class="{ 'modal-open': showModal }">
      <div class="modal-box w-11/12 max-w-4xl">
        <h3 class="font-bold text-lg mb-4">Edit Text</h3>

        <!-- Textarea editor -->
        <div class="form-control mb-4">
          <textarea
            v-model="editValue"
            class="textarea textarea-bordered h-96"
            :placeholder="placeholder"
          ></textarea>
          <label class="label">
            <span class="label-text-alt">{{ characterCount }} characters</span>
          </label>
        </div>

        <!-- Actions -->
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" @click="handleCancel">
            Cancel
          </button>
          <button type="button" class="btn btn-primary" @click="handleSave">
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
    type: String,
    default: null
  },
  readonly: {
    type: Boolean,
    default: false
  },
  placeholder: {
    type: String,
    default: 'Enter text...'
  }
})

const emit = defineEmits(['update:modelValue', 'save'])

const showModal = ref(false)
const editValue = ref(props.modelValue)
const modalRef = ref(null)

const displayValue = computed(() => {
  if (!props.modelValue) return ''
  return props.modelValue.length > 100
    ? props.modelValue.substring(0, 100) + '...'
    : props.modelValue
})

const characterCount = computed(() => {
  return editValue.value?.length || 0
})

watch(() => props.modelValue, (newVal) => {
  editValue.value = newVal
})

function openModal() {
  if (props.readonly) return
  showModal.value = true
  editValue.value = props.modelValue
}

function handleSave() {
  showModal.value = false
  if (editValue.value !== props.modelValue) {
    emit('update:modelValue', editValue.value)
    emit('save', editValue.value)
  }
}

function handleCancel() {
  showModal.value = false
  editValue.value = props.modelValue
}
</script>
