import { ref } from 'vue'

// Notification types
export const NotificationType = {
  SUCCESS: 'success',
  ERROR: 'error',
  INFO: 'info',
  WARNING: 'warning'
}

// Global notification state
const notifications = ref([])
let notificationId = 0

/**
 * Composable for managing toast notifications
 */
export function useNotifications() {
  const addNotification = (message, type = NotificationType.INFO, duration = 5000) => {
    const id = notificationId++
    const notification = {
      id,
      message,
      type,
      visible: true
    }

    notifications.value.push(notification)

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        removeNotification(id)
      }, duration)
    }

    return id
  }

  const removeNotification = (id) => {
    const index = notifications.value.findIndex(n => n.id === id)
    if (index !== -1) {
      notifications.value.splice(index, 1)
    }
  }

  const clearAll = () => {
    notifications.value = []
  }

  // Convenience methods
  const success = (message, duration = 4000) => {
    return addNotification(message, NotificationType.SUCCESS, duration)
  }

  const error = (message, duration = 6000) => {
    return addNotification(message, NotificationType.ERROR, duration)
  }

  const info = (message, duration = 4000) => {
    return addNotification(message, NotificationType.INFO, duration)
  }

  const warning = (message, duration = 5000) => {
    return addNotification(message, NotificationType.WARNING, duration)
  }

  return {
    notifications,
    addNotification,
    removeNotification,
    clearAll,
    success,
    error,
    info,
    warning
  }
}
