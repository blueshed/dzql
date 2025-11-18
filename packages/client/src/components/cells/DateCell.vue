<template>
  <div class="group relative">
    <input
      v-if="isEditing"
      ref="inputRef"
      v-model="editValue"
      type="date"
      class="input input-sm input-bordered w-full"
      @blur="handleSave"
      @keydown.enter="handleSave"
      @keydown.esc="handleCancel"
    />
    <div
      v-else
      class="px-3 py-2 cursor-pointer hover:bg-base-200 rounded transition-colors"
      @click="startEdit"
    >
      {{ displayValue }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch } from 'vue'

const props = defineProps({
  modelValue: {
    type: String,
    default: null
  },
  readonly: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'save'])

const isEditing = ref(false)
const editValue = ref(formatForInput(props.modelValue))
const inputRef = ref(null)

const displayValue = computed(() => {
  if (!props.modelValue) return '—'
  try {
    return new Date(props.modelValue).toLocaleDateString()
  } catch {
    return props.modelValue
  }
})

watch(() => props.modelValue, (newVal) => {
  editValue.value = formatForInput(newVal)
})

function formatForInput(dateString) {
  if (!dateString) return ''
  try {
    const date = new Date(dateString)
    return date.toISOString().split('T')[0]
  } catch {
    return ''
  }
}

async function startEdit() {
  if (props.readonly) return
  isEditing.value = true
  await nextTick()
  inputRef.value?.focus()
}

function handleSave() {
  isEditing.value = false
  if (editValue.value !== formatForInput(props.modelValue)) {
    emit('update:modelValue', editValue.value)
    emit('save', editValue.value)
  }
}

function handleCancel() {
  isEditing.value = false
  editValue.value = formatForInput(props.modelValue)
}
</script>
