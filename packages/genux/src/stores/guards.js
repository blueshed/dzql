import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useMetadataStore } from './metadata'
import { useWebSocketStore } from './websocket'

export const useGuardsStore = defineStore('guards', () => {
  const metadata = useMetadataStore()
  const ws = useWebSocketStore()

  // Computed
  const currentUser = computed(() => ws.user)
  const currentUserId = computed(() => ws.user?.id)

  // Actions
  function canPerform(entity, action, record = null) {
    const config = metadata.getEntity(entity)
    if (!config) {
      return { allowed: false, reason: `Entity ${entity} not found` }
    }

    const paths = config.permission_paths?.[action] || []

    // No paths means unrestricted access
    if (paths.length === 0) {
      return { allowed: true }
    }

    // If user is not logged in, deny access
    if (!currentUserId.value) {
      return {
        allowed: false,
        reason: 'Authentication required'
      }
    }

    // Check if any permission path would allow access
    for (const path of paths) {
      const result = evaluatePermissionPath(path, entity, record)
      if (result.allowed) {
        return result
      }
    }

    return {
      allowed: false,
      reason: explainGuard(entity, action, paths)
    }
  }

  function evaluatePermissionPath(path, entity, record = null) {
    // Simplified path evaluation - in real implementation would resolve full paths

    // Direct user reference
    if (path === '@user_id' || path === '@id') {
      return {
        allowed: true,
        reason: 'User owns this record'
      }
    }

    // Empty path (unrestricted)
    if (path === '' || path === []) {
      return { allowed: true }
    }

    // Organization membership paths
    if (path.includes('acts_for') && path.includes('user_id')) {
      // Simplified - would actually resolve the path
      return {
        allowed: true,
        reason: 'User has organization membership'
      }
    }

    // Owner/creator paths
    if (path.includes('owner') || path.includes('creator')) {
      return {
        allowed: !!currentUserId.value,
        reason: 'User is owner/creator'
      }
    }

    // Default to allowed for now (in real implementation would resolve paths)
    return {
      allowed: true,
      reason: 'Permission path resolved'
    }
  }

  function explainGuard(entity, action, paths) {
    const explanations = {
      create: `Creating ${entity} requires appropriate permissions`,
      update: `Updating ${entity} requires ownership or delegation rights`,
      delete: `Deleting ${entity} requires ownership rights`,
      view: `Viewing ${entity} may be restricted`
    }

    const baseExplanation = explanations[action] || `Action ${action} is restricted`

    // Add specific path information
    if (paths.length > 0) {
      const pathHints = paths.map(path => {
        if (path.includes('acts_for')) return 'organization membership'
        if (path.includes('owner')) return 'ownership'
        if (path.includes('user_id')) return 'user identity'
        return 'specific permissions'
      })

      const uniqueHints = [...new Set(pathHints)]
      return `${baseExplanation}. Requires: ${uniqueHints.join(' or ')}`
    }

    return baseExplanation
  }

  function getActionState(entity, action, record = null) {
    const guard = canPerform(entity, action, record)
    return {
      enabled: guard.allowed,
      disabled: !guard.allowed,
      reason: guard.reason,
      tooltip: guard.allowed ? `Perform ${action}` : guard.reason
    }
  }

  function getNotificationPreview(entity, action, data = {}) {
    const config = metadata.getEntity(entity)
    if (!config) return { total: 0, byChannel: {}, preview: [] }

    const paths = config.notification_paths || {}
    const preview = { total: 0, byChannel: {}, preview: [] }

    for (const [channel, pathList] of Object.entries(paths)) {
      // Simplified notification resolution
      const estimatedRecipients = pathList.length * 2 // Mock estimation

      preview.byChannel[channel] = {
        count: estimatedRecipients,
        paths: pathList
      }

      preview.total += estimatedRecipients
    }

    // Format preview for UI
    preview.preview = Object.entries(preview.byChannel)
      .filter(([_, info]) => info.count > 0)
      .map(([channel, info]) => ({
        channel,
        count: info.count,
        description: formatChannelDescription(channel, info.count)
      }))

    return preview
  }

  function formatChannelDescription(channel, count) {
    const descriptions = {
      ownership: `${count} owner(s)`,
      commercial: `${count} commercial contact(s)`,
      delegated: `${count} delegated user(s)`,
      parties: `${count} involved partie(s)`
    }

    return descriptions[channel] || `${count} user(s) in ${channel}`
  }

  function checkBulkAction(entity, action, recordIds = []) {
    if (recordIds.length === 0) {
      return { allowed: false, reason: 'No records selected' }
    }

    // Check if action is allowed for the entity type
    const baseCheck = canPerform(entity, action)
    if (!baseCheck.allowed) {
      return baseCheck
    }

    // For bulk operations, we'd need to check each record individually
    // For now, assume if base action is allowed, bulk is allowed
    return {
      allowed: true,
      reason: `Bulk ${action} allowed for ${recordIds.length} records`,
      recordCount: recordIds.length
    }
  }

  function getAvailableActions(entity, record = null) {
    const allActions = ['view', 'create', 'update', 'delete']
    const available = []

    for (const action of allActions) {
      const state = getActionState(entity, action, record)
      if (state.enabled) {
        available.push(action)
      }
    }

    return available
  }

  function getActionsByPermission(entity) {
    const config = metadata.getEntity(entity)
    if (!config?.permission_paths) return {}

    const actionGroups = {}

    for (const [action, paths] of Object.entries(config.permission_paths)) {
      const state = canPerform(entity, action)
      actionGroups[action] = {
        allowed: state.allowed,
        reason: state.reason,
        paths: paths,
        pathCount: paths.length
      }
    }

    return actionGroups
  }

  // Check if user can navigate to a specific path
  function canNavigate(targetPath) {
    const node = metadata.getNavigationNode(targetPath)
    if (!node) return { allowed: false, reason: 'Invalid path' }

    const entity = node.current_entity
    if (!entity) return { allowed: true } // Allow navigation to non-entity nodes

    // Check view permission for the target entity
    return canPerform(entity, 'view')
  }

  // Get guard information for navigation options
  function getNavigationGuards(navigationOptions = []) {
    return navigationOptions.map(option => ({
      ...option,
      guard: canNavigate(option.via || option.to)
    }))
  }

  return {
    // Computed
    currentUser,
    currentUserId,

    // Actions
    canPerform,
    explainGuard,
    getActionState,
    getNotificationPreview,
    checkBulkAction,
    getAvailableActions,
    getActionsByPermission,
    canNavigate,
    getNavigationGuards,
    formatChannelDescription
  }
})
