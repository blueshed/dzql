<template>
  <div class="group relative">
    <input
      v-if="isEditing"
      ref="inputRef"
      v-model="editValue"
      type="text"
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
      {{ displayValue || '—' }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, watch } from 'vue'

const props = defineProps({
  modelValue: {
    type: [String, Number],
    default: null
  },
  readonly: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'save'])

const isEditing = ref(false)
const editValue = ref(props.modelValue)
const inputRef = ref(null)

const displayValue = computed(() => props.modelValue)

watch(() => props.modelValue, (newVal) => {
  editValue.value = newVal
})

async function startEdit() {
  if (props.readonly) return
  isEditing.value = true
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
}

function handleSave() {
  isEditing.value = false
  if (editValue.value !== props.modelValue) {
    emit('update:modelValue', editValue.value)
    emit('save', editValue.value)
  }
}

function handleCancel() {
  isEditing.value = false
  editValue.value = props.modelValue
}
</script>
