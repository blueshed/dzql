<template>
  <div class="toast toast-top toast-end z-50">
    <TransitionGroup name="notification">
      <div
        v-for="notification in notifications"
        :key="notification.id"
        :class="['alert', alertClass(notification.type), 'shadow-lg', 'max-w-md']"
      >
        <component :is="getIcon(notification.type)" class="w-6 h-6 shrink-0" />
        <span>{{ notification.message }}</span>
        <button
          @click="removeNotification(notification.id)"
          class="btn btn-sm btn-ghost btn-circle"
        >
          <XIcon class="w-4 h-4" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<script setup>
import { useNotifications, NotificationType } from '../composables/useNotifications'
import CheckCircleIcon from '@heroicons/vue/24/outline/CheckCircleIcon'
import XCircleIcon from '@heroicons/vue/24/outline/XCircleIcon'
import InformationCircleIcon from '@heroicons/vue/24/outline/InformationCircleIcon'
import ExclamationTriangleIcon from '@heroicons/vue/24/outline/ExclamationTriangleIcon'
import XMarkIcon from '@heroicons/vue/24/outline/XMarkIcon'

const XIcon = XMarkIcon

const { notifications, removeNotification } = useNotifications()

const alertClass = (type) => {
  switch (type) {
    case NotificationType.SUCCESS:
      return 'alert-success'
    case NotificationType.ERROR:
      return 'alert-error'
    case NotificationType.WARNING:
      return 'alert-warning'
    case NotificationType.INFO:
    default:
      return 'alert-info'
  }
}

const getIcon = (type) => {
  switch (type) {
    case NotificationType.SUCCESS:
      return CheckCircleIcon
    case NotificationType.ERROR:
      return XCircleIcon
    case NotificationType.WARNING:
      return ExclamationTriangleIcon
    case NotificationType.INFO:
    default:
      return InformationCircleIcon
  }
}
</script>

<style scoped>
.notification-enter-active,
.notification-leave-active {
  transition: all 0.3s ease;
}

.notification-enter-from {
  opacity: 0;
  transform: translateX(30px);
}

.notification-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

.notification-move {
  transition: transform 0.3s ease;
}
</style>
