import { WebSocket as Socket, WebSocketServer as SocketServer } from './ws/runtime';
import type * as Contract from './ws/contracts';

// Structural assignments require actual implementations for every selected member.
const WebSocket: Contract.WebSocketModule['default'] = Socket;
type WebSocket = Contract.WebSocket;
const WebSocketServer: Contract.WebSocketServerConstructor = SocketServer;
type WebSocketServer<Tracking extends boolean = true> = Contract.WebSocketServer<Tracking>;

export { WebSocket as default, WebSocket, WebSocketServer };
export type * from './ws/contracts';
