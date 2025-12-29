// Core WebSocket Manager for TZQL Client
// Handles connection, auth, reconnects, and message dispatching.
// This is a pure transport layer - it does not manage or cache data.

export interface WebSocketOptions {
  url?: string;
  maxReconnectAttempts?: number;
  tokenName?: string;
}

// Get default token name from environment (build-time injection)
function getDefaultTokenName(): string {
  // Vite: import.meta.env.VITE_TZQL_TOKEN_NAME
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TZQL_TOKEN_NAME) {
    // @ts-ignore
    return import.meta.env.VITE_TZQL_TOKEN_NAME;
  }
  // Node/bundlers: process.env.TZQL_TOKEN_NAME
  if (typeof process !== 'undefined' && process.env?.TZQL_TOKEN_NAME) {
    return process.env.TZQL_TOKEN_NAME;
  }
  return 'tzql_token';
}

export class WebSocketManager {
  protected ws: WebSocket | null = null;
  protected messageId = 0;
  protected pendingRequests = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
  protected methodHandlers = new Map<string, Set<(params: any) => void>>();
  protected subscriptionCallbacks = new Map<string, (event: any) => void>();
  protected readyCallbacks = new Set<(user: any) => void>();
  protected reconnectAttempts = 0;
  protected maxReconnectAttempts = 5;
  protected tokenName = 'tzql_token';
  protected isShuttingDown = false;

  // Connection state
  public user: any = null;
  public ready: boolean = false;

  // To be populated by generated code
  public api: any = {};

  constructor(options: WebSocketOptions = {}) {
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.tokenName = options.tokenName ?? getDefaultTokenName();
  }

  async login(credentials: any) {
    try {
      const result = await this.call('login_user', credentials);
      if (result && result.token) {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(this.tokenName, result.token);
        }
        await this.authenticate(result.token);
      }
      return result;
    } catch (e) {
      throw e;
    }
  }

  async authenticate(token: string) {
    return this.call('auth', { token });
  }

  async register(credentials: any, options: any = {}) {
    try {
      const params = { ...credentials, options };
      const result = await this.call('register_user', params);
      if (result && result.token) {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(this.tokenName, result.token);
        }
      }
      return result;
    } catch (e) {
      throw e;
    }
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
        if (typeof window !== "undefined") {
          const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
          wsUrl = protocol + "//" + window.location.host + "/ws";
        } else {
          wsUrl = "ws://localhost:3000/ws";
        }
      }

      if (typeof localStorage !== 'undefined') {
        const token = localStorage.getItem(this.tokenName);
        if (token) {
          if (wsUrl.includes('?')) wsUrl += '&token=' + encodeURIComponent(token);
          else wsUrl += '?token=' + encodeURIComponent(token);
        }
      }

      const connectionTimeout = setTimeout(() => {
        if (this.ws) this.ws.close();
        reject(new Error('WebSocket connection timed out after ' + timeout + 'ms'));
      }, timeout);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log('[TZQL] Connected to ' + wsUrl);
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error("[TZQL] Failed to parse message:", error);
        }
      };

      this.ws.onclose = () => {
        console.log("[TZQL] Disconnected");
        if (!this.isShuttingDown) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        console.error("[TZQL] Connection error:", error);
        reject(error);
      };
    });
  }

  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = 1000 * this.reconnectAttempts;
      setTimeout(() => {
        console.log('[TZQL] Reconnecting (' + this.reconnectAttempts + ')...');
        this.connect();
      }, delay);
    }
  }

  handleMessage(message: any) {
    // Handle connection:ready message
    if (message.method === "connection:ready") {
      this.user = message.params?.user || null;
      this.ready = true;
      this.readyCallbacks.forEach((cb) => cb(this.user));
      return;
    }

    // Handle RPC responses (messages with id)
    if (message.id && this.pendingRequests.has(message.id)) {
      const resolver = this.pendingRequests.get(message.id);
      if (resolver) {
        this.pendingRequests.delete(message.id);
        if (message.error) {
          const err: any = new Error(message.error.message || 'Unknown error');
          err.code = message.error.code;
          resolver.reject(err);
        } else {
          resolver.resolve(message.result);
        }
      }
      return;
    }

    // Handle subscription events - dispatch to registered subscription callbacks
    if (message.method === "subscription:event") {
      const event = message.params?.event;
      if (event) {
        // Dispatch to all subscription handlers - they filter by table/scope
        for (const [subId, callback] of this.subscriptionCallbacks) {
          callback(event);
        }
      }
      return;
    }

    // Handle other server-initiated messages (broadcasts) - route to registered handlers
    if (message.method) {
      const handlers = this.methodHandlers.get(message.method);
      if (handlers) {
        handlers.forEach((cb) => cb(message.params));
      }
    }
  }

  call(method: string, params: any = {}) {
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

  /**
   * Register a callback for a server-initiated method
   * @param method - The method name to listen for
   * @param callback - Called with params when server sends this method
   * @returns Unsubscribe function
   */
  on(method: string, callback: (params: any) => void) {
    if (!this.methodHandlers.has(method)) {
      this.methodHandlers.set(method, new Set());
    }
    this.methodHandlers.get(method)!.add(callback);
    return () => {
      const handlers = this.methodHandlers.get(method);
      if (handlers) {
        handlers.delete(callback);
        if (handlers.size === 0) {
          this.methodHandlers.delete(method);
        }
      }
    };
  }

  /**
   * Register a callback to be called when connection is ready
   * @param callback - Called with user profile (or null if not authenticated)
   * @returns Unsubscribe function
   */
  onReady(callback: (user: any) => void) {
    if (this.ready) {
      callback(this.user);
    }
    this.readyCallbacks.add(callback);
    return () => this.readyCallbacks.delete(callback);
  }

  /**
   * Subscribe to a subscribable document
   * @param method - The subscribe method name (e.g., "subscribe_venue_detail")
   * @param params - Subscription parameters
   * @param callback - Called with initial data and on updates
   * @returns Promise that resolves to an unsubscribe function
   */
  async subscribe(method: string, params: any, callback: (data: any) => void): Promise<() => void> {
    // Call server to get initial snapshot and subscription_id
    const result = await this.call(method, params) as {
      subscription_id: string;
      data: any;
    };

    // Register callback for subscription events
    this.subscriptionCallbacks.set(result.subscription_id, callback);

    // Call callback with initial data
    callback(result.data);

    // Return unsubscribe function
    return () => {
      this.subscriptionCallbacks.delete(result.subscription_id);
      // Notify server
      this.call(`unsubscribe_${method.replace('subscribe_', '')}`, { subscription_id: result.subscription_id }).catch(() => {});
    };
  }
}
