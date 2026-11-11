/** Compile-only checks for actual runtime event-property and listener inference. */
import type { Data } from '../../src/ws/contracts';
import type { WebSocket } from '../../src/ws/runtime';
import type { SocketEventMap } from '../../src/ws/events';

declare const socket: WebSocket;
declare function acceptSocket(value: WebSocket): void;

socket.onopen = function (event) {
  acceptSocket(this);
  acceptSocket(event.target);
  this.send('hello');
};
socket.onmessage = function (event) {
  acceptSocket(this);
  const data: Data = event.data;
  console.log(data);

  // @ts-expect-error Event data inference must not fall back to any.
  event.data.notARealMethod();

  // @ts-expect-error Event fields are read-only.
  event.data = 'replacement';
};
socket.onerror = (event) => {
  if (event.error instanceof Error) console.log(event.error.message);

  // @ts-expect-error Error details remain unknown until narrowed.
  console.log(event.error.message);
};
socket.onclose = (event) => console.log(event.code.toFixed(), event.reason, event.wasClean);
socket.onmessage = null;
socket.addEventListener(
  'message',
  function (event) {
    acceptSocket(this);
    acceptSocket(event.target);
  },
  { once: true },
);
const object = {
  handleEvent(event: SocketEventMap['close']) {
    console.log(event.code);
  },
};
socket.addEventListener('close', object);
socket.removeEventListener('close', object);
type AssertVoid<Value extends ReturnType<() => void>> = Value;
export type AddEventListenerReturnsVoid = AssertVoid<ReturnType<WebSocket['addEventListener']>>;

// @ts-expect-error Only the selected ws event names are accepted.
socket.addEventListener('custom', () => {});

// @ts-expect-error Capture options are excluded.
socket.addEventListener('open', () => {}, { capture: true });

// @ts-expect-error Event properties accept a function or null, not listener objects.
socket.onclose = object;
