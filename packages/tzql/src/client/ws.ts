// Core WebSocket Manager for DZQL Client
// Handles connection, auth, reconnects, and message dispatching.

export interface WebSocketOptions {
  url?: string;
  maxReconnectAttempts?: number;
  tokenName?: string;
}

function getDefaultTokenName(): string {
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DZQL_TOKEN_NAME) {
    // @ts-ignore
    return import.meta.env.VITE_DZQL_TOKEN_NAME;
  }
  if (typeof process !== 'undefined' && process.env?.DZQL_TOKEN_NAME) {
    return process.env.DZQL_TOKEN_NAME;
  }
  return 'dzql_token';
}

/** Schema returned from subscription */
interface SubscriptionSchema {
  root?: string;
  paths?: Record<string, string>;
  scopeTables?: string[];
}

/** Subscription entry stored on client */
interface SubscriptionEntry {
  callback: (data: any) => void;
  schema: SubscriptionSchema;
  localData: any;
}

/** Handler signature for store table_changed methods */
export type TableChangedHandler = (table: string, op: string, pk: Record<string, unknown>, data: unknown) => void;

export class WebSocketManager {
  protected ws: WebSocket | null = null;
  protected messageId = 0;
  protected pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  protected methodHandlers = new Map<string, Set<(params: any) => void>>();
  protected subscriptions = new Map<string, SubscriptionEntry>();
  protected readyCallbacks = new Set<(user: any) => void>();
  protected storeHandlers = new Set<TableChangedHandler>();
  protected reconnectAttempts = 0;
  protected maxReconnectAttempts = 5;
  protected tokenName = 'dzql_token';
  protected isShuttingDown = false;

  public user: any = null;
  public ready: boolean = false;
  public api: any = {};

  constructor(options: WebSocketOptions = {}) {
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.tokenName = options.tokenName ?? getDefaultTokenName();
  }

  async login(credentials: any) {
    const result = await this.call('login_user', credentials) as { token?: string };
    if (result?.token && typeof localStorage !== 'undefined') {
      localStorage.setItem(this.tokenName, result.token);
    }
    return result;
  }

  async authenticate(token: string) {
    return this.call('auth', { token });
  }

  async register(credentials: any, options: any = {}) {
    const params = { ...credentials, options };
    const result = await this.call('register_user', params) as { token?: string };
    if (result?.token && typeof localStorage !== 'undefined') {
      localStorage.setItem(this.tokenName, result.token);
    }
    return result;
  }

  async logout() {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.tokenName);
    }
    this.user = null;
    this.ready = false;
    try { await this.call('logout'); } catch(e) {}
    this.ws?.close();
  }

  connect(url: string | null = null, timeout = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ready = false;
      this.user = null;

      let wsUrl = url;
      if (!wsUrl) {
        if (typeof globalThis !== "undefined" && "window" in globalThis) {
          const win = globalThis as unknown as { location: { protocol: string; host: string } };
          const protocol = win.location.protocol === "https:" ? "wss:" : "ws:";
          wsUrl = protocol + "//" + win.location.host + "/ws";
        } else {
          wsUrl = "ws://localhost:3000/ws";
        }
      }

      if (typeof localStorage !== 'undefined') {
        const token = localStorage.getItem(this.tokenName);
        if (token) {
          wsUrl += (wsUrl.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
        }
      }

      const connectionTimeout = setTimeout(() => {
        this.ws?.close();
        reject(new Error('WebSocket connection timed out'));
      }, timeout);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          this.handleMessage(JSON.parse(event.data));
        } catch (error) {
          console.error("[DZQL] Failed to parse message:", error);
        }
      };

      this.ws.onclose = () => {
        if (!this.isShuttingDown) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        reject(error);
      };
    });
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => this.connect(), 1000 * this.reconnectAttempts);
    }
  }

  handleMessage(message: any) {
    // Handle connection:ready
    if (message.method === "connection:ready") {
      this.user = message.params?.user || null;
      this.ready = true;
      this.readyCallbacks.forEach((cb) => cb(this.user));
      return;
    }

    // Handle RPC responses
    if (message.id && this.pendingRequests.has(message.id)) {
      const resolver = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);
      if (message.error) {
        const err: any = new Error(message.error.message || 'Unknown error');
        err.code = message.error.code;
        resolver.reject(err);
      } else {
        resolver.resolve(message.result);
      }
      return;
    }

    // Handle subscription events - dispatch by subscription_id
    if (message.method === "subscription:event") {
      const { subscription_id, event } = message.params || {};
      const sub = this.subscriptions.get(subscription_id);
      if (sub && event) {
        this.applyAtomicUpdate(sub, event);
      }
      return;
    }

    // Handle entity broadcasts (e.g. "venues:update", "users:insert")
    if (message.method && message.method.includes(':')) {
      const [table, op] = message.method.split(':');
      const { pk, data } = message.params || {};

      // Dispatch to registered store handlers
      this.storeHandlers.forEach(handler => handler(table, op, pk, data));

      // Also dispatch to legacy broadcast handlers
      this.dispatchBroadcast(message.method, message.params);
    }

    // Handle other broadcasts via methodHandlers
    if (message.method) {
      const handlers = this.methodHandlers.get(message.method);
      handlers?.forEach((cb) => cb(message.params));
    }
  }

  /**
   * Apply an atomic update to a subscription's local data
   */
  private applyAtomicUpdate(sub: SubscriptionEntry, event: { table: string; op: string; pk: any; data: any }) {
    const { table, op, pk, data } = event;
    const { schema, localData, callback } = sub;

    if (!schema || !localData) {
      if (data) callback(data);
      return;
    }

    const path = schema.paths?.[table];
    if (!path) {
      console.warn(`Unknown table ${table} in subscription`);
      return;
    }

    if (path === '.' || table === schema.root) {
      // Root entity changed
      if (op === 'update' && data) {
        Object.assign(localData[schema.root!] || localData, data);
      }
    } else {
      // Relation changed - find and update in nested structure
      this.applyRelationUpdate(localData, path, op, pk, data);
    }

    callback(localData);
  }

  /**
   * Apply update to a nested relation
   */
  private applyRelationUpdate(doc: any, path: string, op: string, pk: any, data: any) {
    const parts = path.split('.');
    let target = doc;

    // Navigate to parent
    for (let i = 0; i < parts.length - 1; i++) {
      target = target?.[parts[i]];
      if (!target) return;
    }

    const key = parts[parts.length - 1];
    const arr = target[key];

    if (!Array.isArray(arr)) return;

    const pkValue = pk?.id;
    const idx = arr.findIndex((item: any) => item?.id === pkValue);

    if (op === 'insert' && idx === -1 && data) {
      arr.push(data);
    } else if (op === 'update' && idx !== -1 && data) {
      Object.assign(arr[idx], data);
    } else if (op === 'delete' && idx !== -1) {
      arr.splice(idx, 1);
    }
  }

  call(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not connected"));
        return;
      }
      const id = ++this.messageId;
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
    });
  }

  on(method: string, callback: (params: any) => void) {
    if (!this.methodHandlers.has(method)) {
      this.methodHandlers.set(method, new Set());
    }
    this.methodHandlers.get(method)!.add(callback);
    return () => {
      const handlers = this.methodHandlers.get(method);
      if (handlers) {
        handlers.delete(callback);
        if (handlers.size === 0) this.methodHandlers.delete(method);
      }
    };
  }

  onReady(callback: (user: any) => void) {
    if (this.ready) callback(this.user);
    this.readyCallbacks.add(callback);
    return () => this.readyCallbacks.delete(callback);
  }

  /**
   * Register a store's table_changed handler.
   * Called automatically by generated stores.
   * @returns Unregister function
   */
  registerStore(handler: TableChangedHandler): () => void {
    this.storeHandlers.add(handler);
    return () => this.storeHandlers.delete(handler);
  }

  /**
   * Register a callback for entity broadcast events.
   * Called when entities you have permission to view are created/updated/deleted.
   * The method format is "table:op" (e.g. "venues:update", "users:insert").
   *
   * @param callback - Function called with (method, params) for each broadcast
   * @returns Unsubscribe function
   */
  onBroadcast(callback: (method: string, params: { pk: any; data: any }) => void): () => void {
    const handler = (params: any) => {
      // The method name is stored on the callback context
    };

    // Use a special marker to track broadcast handlers
    const broadcastHandler = { callback, marker: 'broadcast' as const };
    if (!this._broadcastHandlers) {
      this._broadcastHandlers = new Set();
    }
    this._broadcastHandlers.add(broadcastHandler);

    return () => {
      this._broadcastHandlers?.delete(broadcastHandler);
    };
  }

  protected _broadcastHandlers?: Set<{ callback: (method: string, params: any) => void; marker: 'broadcast' }>;

  /**
   * Dispatch a broadcast event to all broadcast handlers
   */
  protected dispatchBroadcast(method: string, params: any) {
    this._broadcastHandlers?.forEach(h => h.callback(method, params));
  }

  /**
   * Subscribe to a subscribable document
   */
  async subscribe(method: string, params: any, callback: (data: any) => void): Promise<() => void> {
    const result = await this.call(method, params) as {
      subscription_id: string;
      data: any;
      schema?: SubscriptionSchema;
    };

    // Store subscription with local data for atomic updates
    this.subscriptions.set(result.subscription_id, {
      callback,
      schema: result.schema || {},
      localData: result.data
    });

    // Call callback with initial data
    callback(result.data);

    // Return unsubscribe function
    return () => {
      this.subscriptions.delete(result.subscription_id);
      this.call(`unsubscribe_${method.replace('subscribe_', '')}`, params).catch(() => {});
    };
  }
}
