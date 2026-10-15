// Loading and constructibility fixture only; no connections or delivery behavior.
export class WebSocket {}

export class WebSocketServer {}

Object.assign(WebSocket, {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
  WebSocket,
  WebSocketServer,
});
