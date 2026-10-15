/** Selected ws contract. Runtime exports and generated declarations belong to #562. */
interface BufferShape extends Uint8Array {
  toString(encoding?: string, start?: number, end?: number): string;
  equals(other: Uint8Array): boolean;
}

/** Preserve Node Buffer when its ambient type exists, without requiring Node types. */
export type ByteBuffer = typeof globalThis extends {
  Buffer: { isBuffer(value: unknown): value is infer B };
}
  ? B extends BufferShape
    ? B
    : BufferShape
  : BufferShape;

// Custom EventEmitter events accept application-defined arguments, as in ws.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyListener = (...args: any[]) => void;
type AnyArguments = Parameters<AnyListener>;
type EventName = string | symbol;
type RawListener = AnyListener & { listener?: AnyListener };

interface Emitter<Events extends { [Event in keyof Events]: unknown[] }> {
  on<Event extends keyof Events>(
    event: Event,
    listener: (this: this, ...args: Events[Event]) => void,
  ): this;
  on(event: EventName, listener: (this: this, ...args: AnyArguments) => void): this;
  once<Event extends keyof Events>(
    event: Event,
    listener: (this: this, ...args: Events[Event]) => void,
  ): this;
  once(event: EventName, listener: (this: this, ...args: AnyArguments) => void): this;
  off<Event extends keyof Events>(
    event: Event,
    listener: (this: this, ...args: Events[Event]) => void,
  ): this;
  off(event: EventName, listener: (this: this, ...args: AnyArguments) => void): this;
  addListener<Event extends keyof Events>(
    event: Event,
    listener: (this: this, ...args: Events[Event]) => void,
  ): this;
  addListener(event: EventName, listener: (this: this, ...args: AnyArguments) => void): this;
  removeListener<Event extends keyof Events>(
    event: Event,
    listener: (this: this, ...args: Events[Event]) => void,
  ): this;
  removeListener(event: EventName, listener: (this: this, ...args: AnyArguments) => void): this;
  removeAllListeners(event?: EventName): this;
  emit<Event extends keyof Events>(event: Event, ...args: Events[Event]): boolean;
  emit(event: EventName, ...args: AnyArguments): boolean;
  listeners(event: EventName): AnyListener[];
  rawListeners(event: EventName): RawListener[];
  listenerCount(event: EventName, listener?: AnyListener): number;
  eventNames(): EventName[];
}

export type RawData = ByteBuffer | ArrayBuffer;
export type Data = string | RawData;
export type SendData =
  | string
  | number
  | ByteBuffer
  | ArrayBuffer
  | SharedArrayBuffer
  | ArrayBufferView
  | readonly unknown[]
  | { valueOf(): string | ArrayBuffer | SharedArrayBuffer | Uint8Array | readonly unknown[] }
  | { [Symbol.toPrimitive](hint: string): string };
export interface SendOptions {
  binary?: boolean | undefined;
}
export type SendCallback = (error?: Error) => void;

interface SocketEvents {
  open: [];
  message: [data: RawData, isBinary: boolean];
  error: [error: Error];
  close: [code: number, reason: ByteBuffer];
}
interface ServerEvents {
  connection: [socket: ServerWebSocket, request: ConnectionRequest];
  listening: [];
  close: [];
  error: [error: Error];
}

interface StateConstants {
  readonly CONNECTING: 0;
  readonly OPEN: 1;
  readonly CLOSING: 2;
  readonly CLOSED: 3;
}

/** A shared annotation accepts both client and accepted server sockets. */
export interface WebSocket extends StateConstants, Emitter<SocketEvents> {
  readonly readyState: 0 | 1 | 2 | 3;
  readonly url: string | undefined;
  binaryType: 'nodebuffer' | 'arraybuffer';
  send(data: SendData, callback?: SendCallback): void;
  send(data: SendData, options?: SendOptions, callback?: SendCallback): void;
  close(code?: number, reason?: string | ByteBuffer): void;
  terminate(): void;
  addEventListener<Event extends keyof WebSocketEventMap>(
    type: Event,
    listener: EventListener<Event>,
    options?: EventListenerOptions,
  ): void;
  removeEventListener<Event extends keyof WebSocketEventMap>(
    type: Event,
    listener: EventListener<Event>,
  ): void;
  onopen: ((this: WebSocket, event: Event) => void) | null;
  onmessage: ((this: WebSocket, event: MessageEvent) => void) | null;
  onerror: ((this: WebSocket, event: ErrorEvent) => void) | null;
  onclose: ((this: WebSocket, event: CloseEvent) => void) | null;
}
export interface ClientWebSocket extends WebSocket {
  readonly url: string;
}
export interface ServerWebSocket extends WebSocket {
  readonly url: undefined;
}
export interface WebSocketConstructor extends StateConstants {
  new (address: string | URL): ClientWebSocket;
}

export interface AddressInfo {
  address: string;
  family: string;
  port: number;
}
export interface RequestHeaders {
  [name: string]: string | string[] | undefined;
  host?: string | undefined;
  connection?: string | undefined;
  upgrade?: string | undefined;
  'sec-websocket-key'?: string | undefined;
  'sec-websocket-version'?: string | undefined;
}
export interface ConnectionRequest {
  url: string;
  method: string;
  headers: RequestHeaders;
}
export interface ListeningServer {
  address(): AddressInfo | null;
}
export type ListeningCallback = (this: ListeningServer) => void;
export interface ServerOptions<Tracking extends boolean = boolean> {
  port: number;
  host?: string | undefined;
  path?: string | undefined;
  clientTracking?: Tracking | undefined;
}
export interface WebSocketServer<Tracking extends boolean = true> extends Emitter<ServerEvents> {
  // With tracking disabled, ws has no clients property; reading it gives undefined.
  clients: Tracking extends true ? Set<ServerWebSocket> : undefined;
  address(): AddressInfo | null;
  close(callback?: (error?: Error) => void): void;
}
export interface WebSocketServerConstructor {
  new <Options extends ServerOptions>(
    options: Options,
    callback?: ListeningCallback,
  ): WebSocketServer<TracksClients<Options>>;
}
// ws defaults an omitted setting to true, but an explicit undefined disables it.
type TracksClients<Options> = 'clientTracking' extends keyof Options
  ? Options extends { clientTracking: infer Tracking }
    ? Tracking extends true
      ? true
      : false
    : boolean
  : true;
interface WebSocketExport extends WebSocketConstructor {
  readonly WebSocket: WebSocketExport;
  readonly WebSocketServer: WebSocketServerConstructor;
}
/** CommonJS exposes the constructor through default and the named WebSocket export. */
export interface WebSocketModule {
  readonly default: WebSocketExport;
  readonly WebSocket: WebSocketExport;
  readonly WebSocketServer: WebSocketServerConstructor;
}
export type Server<Tracking extends boolean = true> = WebSocketServer<Tracking>;

export interface Event {
  readonly type: string;
  readonly target: WebSocket;
}
export interface MessageEvent extends Event {
  readonly data: Data;
}
export interface ErrorEvent extends Event {
  readonly error: unknown;
  readonly message: string;
}
export interface CloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}
export interface WebSocketEventMap {
  open: Event;
  message: MessageEvent;
  error: ErrorEvent;
  close: CloseEvent;
}
export interface EventListenerOptions {
  once?: boolean | undefined;
}
export type EventListener<Event extends keyof WebSocketEventMap> =
  | ((this: WebSocket, event: WebSocketEventMap[Event]) => void)
  | { handleEvent(event: WebSocketEventMap[Event]): void };
