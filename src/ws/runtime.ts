import { Buffer } from 'node:buffer';
import type {
  AddressInfo,
  ConnectionRequest,
  EventListenerOptions,
  ListeningCallback,
  ServerOptions,
} from './contracts';
import { WsEmitter } from './emitter';
import { WsEventTarget } from './event-target';
import type { SocketEvents } from './event-target';
import type { SocketEventHandler, SocketEventListener, SocketEventName } from './events';
import { findServer, register, unregister } from './registry';

interface ServerEvents {
  connection: [socket: WebSocket, request: ConnectionRequest];
  listening: [];
  error: [error: Error];
  close: [];
}

function clientUrl(address: string | URL): URL {
  let url: URL;
  try {
    url = address instanceof URL ? address : new URL(address);
  } catch {
    throw new SyntaxError(`Invalid URL: ${address}`);
  }
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (!['ws:', 'wss:'].includes(url.protocol)) {
    throw new SyntaxError('The URL protocol must be ws:, wss:, http:, or https:');
  }
  if (url.hash) throw new SyntaxError('The URL contains a fragment identifier');
  return url;
}

/** Internal basic runtime, not yet bound to the complete public constructor contract. */
export class WebSocket extends WsEmitter<SocketEvents> {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readonly url: string | undefined;
  private state: 0 | 1 | 2 | 3;
  private peer: WebSocket | undefined;
  private server: WebSocketServer | undefined;
  private cleanClose = false;
  private readonly eventTarget = new WsEventTarget(this, () => this.cleanClose);

  get onopen(): SocketEventHandler<'open'> | null {
    return this.eventTarget.get('open');
  }
  set onopen(handler: SocketEventHandler<'open'> | null) {
    this.eventTarget.set('open', handler);
  }
  get onmessage(): SocketEventHandler<'message'> | null {
    return this.eventTarget.get('message');
  }
  set onmessage(handler: SocketEventHandler<'message'> | null) {
    this.eventTarget.set('message', handler);
  }
  get onerror(): SocketEventHandler<'error'> | null {
    return this.eventTarget.get('error');
  }
  set onerror(handler: SocketEventHandler<'error'> | null) {
    this.eventTarget.set('error', handler);
  }
  get onclose(): SocketEventHandler<'close'> | null {
    return this.eventTarget.get('close');
  }
  set onclose(handler: SocketEventHandler<'close'> | null) {
    this.eventTarget.set('close', handler);
  }

  addEventListener<Event extends SocketEventName>(
    type: Event,
    listener: SocketEventListener<Event>,
    options?: EventListenerOptions,
  ): void {
    this.eventTarget.add(type, listener, options);
  }

  removeEventListener<Event extends SocketEventName>(
    type: Event,
    listener: SocketEventListener<Event>,
  ): void {
    this.eventTarget.remove(type, listener);
  }

  // null creates an accepted socket internally, as real ws does after upgrade.
  constructor(address: string | URL | null) {
    super();
    if (address === null) {
      this.url = undefined;
      this.state = WebSocket.OPEN;
      return;
    }
    const url = clientUrl(address);
    this.url = url.href;
    this.state = WebSocket.CONNECTING;
    queueMicrotask(() => {
      if (this.state !== WebSocket.CONNECTING) return;
      const server = findServer(url);
      if (url.protocol !== 'wss:' && server instanceof WebSocketServer && server.accepting) {
        server.connect(this, url);
      } else {
        this.fail(new Error('Unable to connect to a registered ws server'));
      }
    });
  }

  get readyState(): 0 | 1 | 2 | 3 {
    return this.state;
  }

  /** Pairing is internal; no socket.io handshake, namespace, or ACK path is used. */
  accept(client: WebSocket, server: WebSocketServer): void {
    this.peer = client;
    this.server = server;
    client.peer = this;
    // Queue open before user connection handlers can queue a server greeting.
    queueMicrotask(() => {
      if (client.state !== WebSocket.CONNECTING) return;
      client.state = WebSocket.OPEN;
      client.emit('open');
    });
  }

  send(data: string): void {
    if (this.state === WebSocket.CONNECTING) {
      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
    }
    if (this.state !== WebSocket.OPEN) return;
    if (typeof data !== 'string') throw new TypeError('The basic ws runtime accepts text only');
    const bytes = Buffer.from(data);
    const peer = this.peer;
    queueMicrotask(() => {
      if (peer && peer.state !== WebSocket.CLOSED) peer.emit('message', bytes, false);
    });
  }

  close(code?: number, reason?: string | Buffer): void {
    if (this.state === WebSocket.CLOSED || this.state === WebSocket.CLOSING) return;
    if (this.state === WebSocket.CONNECTING) {
      this.fail(new Error('WebSocket was closed before the connection was established'));
      return;
    }
    this.state = WebSocket.CLOSING;
    if (
      code !== undefined &&
      !(
        Number.isInteger(code) &&
        ((code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code)) ||
          (code >= 3000 && code <= 4999))
      )
    ) {
      throw new TypeError('First argument must be a valid error code number');
    }
    const bytes = code === undefined ? Buffer.alloc(0) : Buffer.from(reason ?? '');
    if (bytes.length > 123) throw new RangeError('The message must not be greater than 123 bytes');
    const peer = this.peer;
    queueMicrotask(() => {
      this.finish(code ?? 1005, bytes, true);
      peer?.finish(code ?? 1005, bytes, true);
    });
  }

  /** Also used by test teardown; abrupt-close parity is completed in #540. */
  terminate(): void {
    if (this.state === WebSocket.CLOSED) return;
    if (this.state === WebSocket.CONNECTING) {
      this.fail(new Error('WebSocket was closed before the connection was established'));
      return;
    }
    this.state = WebSocket.CLOSING;
    const peer = this.peer;
    queueMicrotask(() => {
      this.finish(1006, Buffer.alloc(0));
      peer?.finish(1006, Buffer.alloc(0));
    });
  }

  private fail(error: Error): void {
    this.state = WebSocket.CLOSING;
    queueMicrotask(() => {
      try {
        this.emit('error', error);
      } finally {
        const peer = this.peer;
        this.finish(1006, Buffer.alloc(0));
        peer?.finish(1006, Buffer.alloc(0));
      }
    });
  }

  private finish(code: number, reason: Buffer, clean = false): void {
    if (this.state === WebSocket.CLOSED) return;
    this.state = WebSocket.CLOSED;
    this.cleanClose = clean;
    this.peer = undefined;
    const server = this.server;
    this.server = undefined;
    server?.remove(this);
    this.emit('close', code, Buffer.from(reason));
  }
}

for (const property of ['onopen', 'onerror', 'onclose', 'onmessage']) {
  Object.defineProperty(WebSocket.prototype, property, { enumerable: true });
}

export class WebSocketServer extends WsEmitter<ServerEvents> {
  readonly host: string | undefined;
  readonly path: string | undefined;
  private info: AddressInfo | null;
  private running = true;
  private finished = false;
  private readonly sockets = new Set<WebSocket>();

  constructor(options: ServerOptions, callback?: ListeningCallback) {
    super();
    this.host = options.host;
    this.path = options.path;
    this.info = register(this, options.port);
    const receiver = { address: () => this.address() };
    queueMicrotask(() => {
      if (!this.running) return;
      if (!this.info) {
        this.running = false;
        this.emit(
          'error',
          Object.assign(new Error('Address already in use'), { code: 'EADDRINUSE' }),
        );
        return;
      }
      callback?.call(receiver);
      this.emit('listening');
    });
  }

  get accepting(): boolean {
    return this.running && this.info !== null;
  }

  address(): AddressInfo | null {
    return this.info ? { ...this.info } : null;
  }

  connect(client: WebSocket, url: URL): void {
    const socket = new WebSocket(null);
    this.sockets.add(socket);
    socket.accept(client, this);
    const request: ConnectionRequest = {
      url: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        host: url.host,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
          'base64',
        ),
      },
    };
    this.emit('connection', socket, request);
  }

  remove(socket: WebSocket): void {
    this.sockets.delete(socket);
    if (!this.running && this.sockets.size === 0) this.emitClose();
  }

  close(callback?: (error?: Error) => void): void {
    if (this.finished) {
      queueMicrotask(() => {
        callback?.(new Error('The server is not running'));
        this.emit('close');
      });
      return;
    }
    if (callback) this.once('close', callback);
    this.running = false;
    this.info = null;
    unregister(this);
    if (this.sockets.size === 0) queueMicrotask(() => this.emitClose());
  }

  private emitClose(): void {
    if (this.finished) return;
    this.finished = true;
    this.emit('close');
  }
}
