/**
 * Subscription Manager for Live Query Subscriptions
 * Manages in-memory subscription registry and matching
 */

import crypto from 'crypto';
import { wsLogger } from './logger.js';

/**
 * In-memory subscription registry
 * Structure: subscription_id -> { subscribable, user_id, connection_id, params }
 */
const subscriptions = new Map();

/**
 * Track subscriptions by connection for cleanup
 * Structure: connection_id -> Set<subscription_id>
 */
const connectionSubscriptions = new Map();

/**
 * Cache for subscribable metadata (scope tables, path mappings)
 * Structure: subscribable_name -> { scopeTables, pathMapping, rootEntity, relations }
 */
const subscribableMetadataCache = new Map();

/**
 * Register a new subscription
 * @param {string} subscribableName - Name of the subscribable
 * @param {number} userId - User ID
 * @param {string} connectionId - WebSocket connection ID
 * @param {object} params - Subscription parameters
 * @returns {string} - Subscription ID
 */
export function registerSubscription(subscribableName, userId, connectionId, params) {
  const subscriptionId = crypto.randomUUID();

  // Store subscription
  subscriptions.set(subscriptionId, {
    subscribable: subscribableName,
    user_id: userId,
    connection_id: connectionId,
    params,
    created_at: new Date()
  });

  // Track by connection
  if (!connectionSubscriptions.has(connectionId)) {
    connectionSubscriptions.set(connectionId, new Set());
  }
  connectionSubscriptions.get(connectionId).add(subscriptionId);

  wsLogger.debug(`Subscription registered: ${subscriptionId.slice(0, 8)}... (${subscribableName})`, {
    user_id: userId,
    params
  });

  return subscriptionId;
}

/**
 * Unregister a subscription
 * @param {string} subscriptionId - Subscription ID to remove
 * @returns {boolean} - True if subscription was found and removed
 */
export function unregisterSubscription(subscriptionId) {
  const sub = subscriptions.get(subscriptionId);

  if (!sub) {
    wsLogger.debug(`Subscription not found: ${subscriptionId}`);
    return false;
  }

  // Remove from connection tracking
  const connSubs = connectionSubscriptions.get(sub.connection_id);
  if (connSubs) {
    connSubs.delete(subscriptionId);
    if (connSubs.size === 0) {
      connectionSubscriptions.delete(sub.connection_id);
    }
  }

  // Remove subscription
  subscriptions.delete(subscriptionId);

  wsLogger.debug(`Subscription removed: ${subscriptionId.slice(0, 8)}...`);
  return true;
}

/**
 * Unregister subscription by params
 * Useful for unsubscribe_* methods that specify params instead of subscription ID
 * @param {string} subscribableName - Name of the subscribable
 * @param {string} connectionId - WebSocket connection ID
 * @param {object} params - Subscription parameters to match
 * @returns {boolean} - True if subscription was found and removed
 */
export function unregisterSubscriptionByParams(subscribableName, connectionId, params) {
  const paramsStr = JSON.stringify(params);

  // Find matching subscription
  for (const [subId, sub] of subscriptions.entries()) {
    if (
      sub.subscribable === subscribableName &&
      sub.connection_id === connectionId &&
      JSON.stringify(sub.params) === paramsStr
    ) {
      return unregisterSubscription(subId);
    }
  }

  wsLogger.debug(`No matching subscription found for ${subscribableName} with params`, params);
  return false;
}

/**
 * Remove all subscriptions for a connection
 * Called when WebSocket connection closes
 * @param {string} connectionId - Connection ID
 * @returns {number} - Number of subscriptions removed
 */
export function removeConnectionSubscriptions(connectionId) {
  const subIds = connectionSubscriptions.get(connectionId);

  if (!subIds) {
    return 0;
  }

  let count = 0;
  for (const subId of subIds) {
    if (subscriptions.delete(subId)) {
      count++;
    }
  }

  connectionSubscriptions.delete(connectionId);

  if (count > 0) {
    wsLogger.info(`Removed ${count} subscription(s) for connection ${connectionId.slice(0, 8)}...`);
  }

  return count;
}

/**
 * Get all subscriptions for a specific subscribable
 * @param {string} subscribableName - Name of the subscribable
 * @returns {Array} - Array of {subscriptionId, subscription} objects
 */
export function getSubscriptionsByName(subscribableName) {
  const result = [];

  for (const [subId, sub] of subscriptions.entries()) {
    if (sub.subscribable === subscribableName) {
      result.push({ subscriptionId: subId, ...sub });
    }
  }

  return result;
}

/**
 * Get all subscriptions grouped by subscribable name
 * @returns {Map<string, Array>} - Map of subscribable name to array of subscriptions
 */
export function getSubscriptionsBySubscribable() {
  const grouped = new Map();

  for (const [subId, sub] of subscriptions.entries()) {
    if (!grouped.has(sub.subscribable)) {
      grouped.set(sub.subscribable, []);
    }
    grouped.get(sub.subscribable).push({ subscriptionId: subId, ...sub });
  }

  return grouped;
}

/**
 * Check if params match (deep equality)
 * @param {object} a - First params object
 * @param {object} b - Second params object
 * @returns {boolean} - True if params match
 */
export function paramsMatch(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Get subscription statistics
 * @returns {object} - Stats object
 */
export function getStats() {
  return {
    total_subscriptions: subscriptions.size,
    active_connections: connectionSubscriptions.size,
    subscriptions_by_subscribable: Array.from(getSubscriptionsBySubscribable().entries()).map(
      ([name, subs]) => ({
        name,
        count: subs.length
      })
    )
  };
}

/**
 * Get all active subscriptions (for debugging)
 * @returns {Array} - Array of all subscriptions
 */
export function getAllSubscriptions() {
  return Array.from(subscriptions.entries()).map(([id, sub]) => ({
    id,
    ...sub
  }));
}

/**
 * Get subscribable metadata (scope tables, path mapping) with caching
 * @param {string} subscribableName - Name of the subscribable
 * @param {function} sql - Database query function
 * @returns {Promise<{scopeTables: string[], pathMapping: object, rootEntity: string, relations: object}>}
 */
export async function getSubscribableMetadata(subscribableName, sql) {
  // Check cache first
  if (subscribableMetadataCache.has(subscribableName)) {
    return subscribableMetadataCache.get(subscribableName);
  }

  // Fetch from database
  const result = await sql`
    SELECT scope_tables, root_entity, relations
    FROM dzql.subscribables
    WHERE name = ${subscribableName}
  `;

  if (!result || result.length === 0) {
    // Return empty metadata if subscribable not found
    const emptyMetadata = {
      scopeTables: [],
      pathMapping: {},
      rootEntity: null,
      relations: {}
    };
    return emptyMetadata;
  }

  const { scope_tables, root_entity, relations } = result[0];

  // Build path mapping from relations
  const pathMapping = buildPathMappingFromRelations(root_entity, relations);

  const metadata = {
    scopeTables: scope_tables || [],
    pathMapping,
    rootEntity: root_entity,
    relations: relations || {}
  };

  // Cache for future use
  subscribableMetadataCache.set(subscribableName, metadata);

  wsLogger.debug(`Cached metadata for subscribable ${subscribableName}:`, {
    scopeTables: metadata.scopeTables,
    pathMapping: metadata.pathMapping
  });

  return metadata;
}

/**
 * Build path mapping from relations configuration
 * Maps table names to their document path for client-side patching
 * @param {string} rootEntity - Root table name
 * @param {object} relations - Relations configuration
 * @returns {object} - Map of table name -> document path
 */
function buildPathMappingFromRelations(rootEntity, relations) {
  const paths = {};

  // Root entity maps to top level
  if (rootEntity) {
    paths[rootEntity] = '.';
  }

  const buildPaths = (rels, parentPath = '') => {
    for (const [relName, relConfig] of Object.entries(rels || {})) {
      const entity = typeof relConfig === 'string' ? relConfig : relConfig?.entity;
      const currentPath = parentPath ? `${parentPath}.${relName}` : relName;

      if (entity) {
        paths[entity] = currentPath;
      }

      // Handle nested relations
      if (typeof relConfig === 'object' && relConfig !== null) {
        if (relConfig.include) {
          buildPaths(relConfig.include, currentPath);
        }
        if (relConfig.relations) {
          buildPaths(relConfig.relations, currentPath);
        }
      }
    }
  };

  buildPaths(relations);
  return paths;
}

/**
 * Clear the subscribable metadata cache
 * Called when subscribables are reregistered or updated
 * @param {string} [subscribableName] - Optional: clear specific subscribable, or all if not provided
 */
export function clearSubscribableMetadataCache(subscribableName = null) {
  if (subscribableName) {
    subscribableMetadataCache.delete(subscribableName);
    wsLogger.debug(`Cleared metadata cache for ${subscribableName}`);
  } else {
    subscribableMetadataCache.clear();
    wsLogger.debug('Cleared all subscribable metadata cache');
  }
}

/**
 * Get scope tables for a subscribable (convenience function)
 * @param {string} subscribableName - Name of the subscribable
 * @param {function} sql - Database query function
 * @returns {Promise<string[]>} - Array of table names in scope
 */
export async function getSubscribableScopeTables(subscribableName, sql) {
  const metadata = await getSubscribableMetadata(subscribableName, sql);
  return metadata.scopeTables;
}
