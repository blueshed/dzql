<template>
  <dialog :class="['modal', { 'modal-open': dialogState.isOpen }]">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-4">{{ dialogState.title }}</h3>
      <p class="py-4">{{ dialogState.message }}</p>
      <div class="modal-action">
        <button
          @click="dialogState.onCancel"
          class="btn"
        >
          {{ dialogState.cancelText }}
        </button>
        <button
          @click="dialogState.onConfirm"
          :class="[
            'btn',
            dialogState.type === 'danger' ? 'btn-error' : 'btn-primary'
          ]"
        >
          {{ dialogState.confirmText }}
        </button>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop" @click="dialogState.onCancel">
      <button>close</button>
    </form>
  </dialog>
</template>

<script setup>
import { useConfirmDialog } from '../composables/useConfirmDialog'

const { dialogState } = useConfirmDialog()
</script>

<style scoped>
/* Modal styles handled by DaisyUI */
</style>
