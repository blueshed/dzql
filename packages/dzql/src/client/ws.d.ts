/**
 * WebSocket manager for DZQL client-side real-time communication
 */
export declare class WebSocketManager {
  ws: WebSocket | null;
  api: Record<string, any>;

  constructor(options?: {
    maxReconnectAttempts?: number;
    tokenName?: string;
  });

  /**
   * Connect to DZQL WebSocket server
   */
  connect(url?: string | null, timeout?: number): Promise<void>;

  /**
   * Call a method via JSON-RPC over WebSocket
   */
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;

  /**
   * Subscribe to a live query
   */
  subscribe(
    method: string,
    params: Record<string, unknown>,
    callback: (data: unknown) => void
  ): Promise<{
    data: unknown;
    subscription_id: string;
    schema: unknown;
    unsubscribe: () => Promise<void>;
  }>;

  /**
   * Unsubscribe from a live query
   */
  unsubscribe(method: string, params?: Record<string, unknown>): Promise<{ success: boolean }>;

  /**
   * Register callback for real-time broadcast events
   */
  onBroadcast(callback: (method: string, params: unknown) => void): () => void;

  /**
   * Remove broadcast callback
   */
  offBroadcast(callback: (method: string, params: unknown) => void): void;

  /**
   * Register a handler for SID requests from server
   */
  onSIDRequest(callback: (method: string, params: unknown) => void): () => void;

  /**
   * Remove SID request handler
   */
  offSIDRequest(callback: (method: string, params: unknown) => void): void;

  /**
   * Respond to a SID request from server
   */
  respondToSID(sid: string, result?: unknown, error?: string | Error | null): Promise<unknown>;

  /**
   * Check if connected
   */
  isConnected(): boolean;

  /**
   * Disconnect from server
   */
  disconnect(): void;

  /**
   * Clean disconnect without reconnection attempts
   */
  cleanDisconnect(): void;

  /**
   * Reset the WebSocket manager to initial state
   */
  reset(): void;

  /**
   * Get connection status
   */
  getStatus(): 'connecting' | 'connected' | 'closing' | 'disconnected' | 'unknown';
}

export declare const useWs: () => WebSocketManager;
