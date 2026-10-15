/** Packaging fixture only: these constructors do not implement ws behavior. */
import { WebSocket as Constructor, WebSocketServer as ServerConstructor } from './runtime.js';
import type * as Contract from './contracts.cjs';

const WebSocket: Contract.WebSocketModule['default'] = Constructor;
type WebSocket = Contract.WebSocket;
const WebSocketServer: Contract.WebSocketServerConstructor = ServerConstructor;
type WebSocketServer<Tracking extends boolean = true> = Contract.WebSocketServer<Tracking>;

export { WebSocket as default, WebSocket, WebSocketServer };
export type * from './contracts.cjs';
