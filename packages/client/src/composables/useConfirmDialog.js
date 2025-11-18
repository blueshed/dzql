import { ref } from 'vue'

// Global dialog state
const dialogState = ref({
  isOpen: false,
  title: '',
  message: '',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  type: 'warning', // warning, danger, info
  onConfirm: null,
  onCancel: null
})

/**
 * Composable for managing confirmation dialogs
 */
export function useConfirmDialog() {
  const showDialog = ({
    title = 'Confirm Action',
    message = 'Are you sure?',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    type = 'warning'
  }) => {
    return new Promise((resolve) => {
      dialogState.value = {
        isOpen: true,
        title,
        message,
        confirmText,
        cancelText,
        type,
        onConfirm: () => {
          dialogState.value.isOpen = false
          resolve(true)
        },
        onCancel: () => {
          dialogState.value.isOpen = false
          resolve(false)
        }
      }
    })
  }

  const confirm = (message, title = 'Confirm') => {
    return showDialog({
      title,
      message,
      type: 'warning',
      confirmText: 'Confirm',
      cancelText: 'Cancel'
    })
  }

  const confirmDelete = (itemName = 'this item') => {
    return showDialog({
      title: 'Confirm Deletion',
      message: `Are you sure you want to delete ${itemName}? This action cannot be undone.`,
      type: 'danger',
      confirmText: 'Delete',
      cancelText: 'Cancel'
    })
  }

  const confirmDanger = (message, title = 'Warning') => {
    return showDialog({
      title,
      message,
      type: 'danger',
      confirmText: 'Continue',
      cancelText: 'Cancel'
    })
  }

  return {
    dialogState,
    showDialog,
    confirm,
    confirmDelete,
    confirmDanger
  }
}
