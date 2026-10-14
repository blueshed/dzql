/**
 * Subscription Manager for Live Query Subscriptions
 * Manages in-memory subscription registry and matching
 */

import crypto from 'crypto';
import { wsLogger } from './logger.js';

/** Subscription entry */
interface Subscription {
  subscribable: string;
  user_id: number | null;
  connection_id: string;
  params: Record<string, unknown>;
  created_at: Date;
}

/** Subscribable metadata */
interface SubscribableMetadata {
  scopeTables: string[];
  pathMapping: Record<string, string>;
  rootEntity: string | null;
}

/** In-memory subscription registry: subscription_id -> subscription */
const subscriptions = new Map<string, Subscription>();

/** Track subscriptions by connection for cleanup: connection_id -> Set<subscription_id> */
const connectionSubscriptions = new Map<string, Set<string>>();

/** Cache for subscribable metadata: subscribable_name -> metadata */
const subscribableMetadataCache = new Map<string, SubscribableMetadata>();

/**
 * Register a new subscription
 */
export function registerSubscription(
  subscribableName: string,
  userId: number | null,
  connectionId: string,
  params: Record<string, unknown>
): string {
  const subscriptionId = crypto.randomUUID();

  subscriptions.set(subscriptionId, {
    subscribable: subscribableName,
    user_id: userId,
    connection_id: connectionId,
    params,
    created_at: new Date()
  });

  if (!connectionSubscriptions.has(connectionId)) {
    connectionSubscriptions.set(connectionId, new Set());
  }
  connectionSubscriptions.get(connectionId)!.add(subscriptionId);

  wsLogger.debug(`Subscription registered: ${subscriptionId.slice(0, 8)}... (${subscribableName})`);

  return subscriptionId;
}

/**
 * Unregister a subscription
 */
export function unregisterSubscription(subscriptionId: string): boolean {
  const sub = subscriptions.get(subscriptionId);

  if (!sub) {
    return false;
  }

  const connSubs = connectionSubscriptions.get(sub.connection_id);
  if (connSubs) {
    connSubs.delete(subscriptionId);
    if (connSubs.size === 0) {
      connectionSubscriptions.delete(sub.connection_id);
    }
  }

  subscriptions.delete(subscriptionId);
  wsLogger.debug(`Subscription removed: ${subscriptionId.slice(0, 8)}...`);
  return true;
}

/**
 * Unregister subscription by params
 */
export function unregisterSubscriptionByParams(
  subscribableName: string,
  connectionId: string,
  params: Record<string, unknown>
): boolean {
  const paramsStr = JSON.stringify(params);

  for (const [subId, sub] of subscriptions.entries()) {
    if (
      sub.subscribable === subscribableName &&
      sub.connection_id === connectionId &&
      JSON.stringify(sub.params) === paramsStr
    ) {
      return unregisterSubscription(subId);
    }
  }

  return false;
}

/**
 * Remove all subscriptions for a connection (called on WebSocket close)
 */
export function removeConnectionSubscriptions(connectionId: string): number {
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
 * Get all subscriptions grouped by subscribable name
 */
export function getSubscriptionsBySubscribable(): Map<string, Array<Subscription & { subscriptionId: string }>> {
  const grouped = new Map<string, Array<Subscription & { subscriptionId: string }>>();

  for (const [subId, sub] of subscriptions.entries()) {
    if (!grouped.has(sub.subscribable)) {
      grouped.set(sub.subscribable, []);
    }
    grouped.get(sub.subscribable)!.push({ subscriptionId: subId, ...sub });
  }

  return grouped;
}

/**
 * Check if params match (deep equality)
 */
export function paramsMatch(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Cache subscribable metadata (from manifest)
 */
export function cacheSubscribableMetadata(subscribableName: string, metadata: SubscribableMetadata): void {
  subscribableMetadataCache.set(subscribableName, metadata);
}

/**
 * Get subscribable metadata from cache
 */
export function getSubscribableMetadata(subscribableName: string): SubscribableMetadata | undefined {
  return subscribableMetadataCache.get(subscribableName);
}

/**
 * Get scope tables for a subscribable
 */
export function getSubscribableScopeTables(subscribableName: string): string[] {
  const metadata = subscribableMetadataCache.get(subscribableName);
  return metadata?.scopeTables || [];
}

/**
 * Clear metadata cache
 */
export function clearSubscribableMetadataCache(subscribableName?: string): void {
  if (subscribableName) {
    subscribableMetadataCache.delete(subscribableName);
  } else {
    subscribableMetadataCache.clear();
  }
}
