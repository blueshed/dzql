<template>
  <div class="flex items-center justify-center py-2">
    <input
      type="checkbox"
      class="checkbox checkbox-sm checkbox-primary"
      :checked="modelValue"
      :disabled="readonly"
      @change="handleChange"
    />
  </div>
</template>

<script setup>
const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  readonly: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'save'])

function handleChange(event) {
  if (props.readonly) return
  const newValue = event.target.checked
  emit('update:modelValue', newValue)
  emit('save', newValue)
}
</script>
