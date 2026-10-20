/** Per-websocket-connection data attached at upgrade time. Not the "session" domain resource. */
export type ConnectionData = {
  sessionId: string;
  /** The address the tab was opened at -- its URL's path and query, without the leading `/` -- routed on open (`Example.address`). None from a socket that is no page's (the CLI's). */
  at?: string;
  /** Where the tab stands now: its address, the tab's own (./tabs.ts), which its page is drawn at. None until it is routed: the page alone. */
  address?: string;
  /** The app the socket is on, whose handlers it is given to: a server may hold several apps' sockets (./server.ts `compose`). */
  on?: Bun.WebSocketHandler<ConnectionData>;
};
