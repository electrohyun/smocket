import type { Server as IoServer, Socket as IoSocket } from 'socket.io';
import type { DefaultEventsMap, ServerContract, ServerSocketContract } from './index';

interface CompletionEvents {
  done: (ack: () => void) => void;
  undefinedResponse: (ack: (response: undefined) => void) => void;
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
  voidResponse: (ack: (response: void) => void) => void;
  noArguments: () => void;
}

type Same<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

export type AssertCloseMatchesTarget = Assert<
  Same<ReturnType<ServerContract['close']>, ReturnType<IoServer['close']>>
>;

declare const mockSocket: ServerSocketContract<DefaultEventsMap, CompletionEvents>;
declare const realSocket: IoSocket<DefaultEventsMap, CompletionEvents>;
declare const mockServer: ServerContract<DefaultEventsMap, CompletionEvents>;
declare const realServer: IoServer<DefaultEventsMap, CompletionEvents>;

const done = [mockSocket.emitWithAck('done'), realSocket.emitWithAck('done')] as const;
const timedDone = [
  mockSocket.timeout(100).emitWithAck('done'),
  realSocket.timeout(100).emitWithAck('done'),
] as const;
const volatileDone = [
  mockSocket.volatile.emitWithAck('done'),
  realSocket.volatile.emitWithAck('done'),
] as const;
const undefinedResponse = [
  mockSocket.emitWithAck('undefinedResponse'),
  realSocket.emitWithAck('undefinedResponse'),
] as const;
const voidResponse = [
  mockSocket.emitWithAck('voidResponse'),
  realSocket.emitWithAck('voidResponse'),
] as const;
const broadcastDone = [
  mockServer.timeout(100).emitWithAck('done'),
  realServer.timeout(100).emitWithAck('done'),
] as const;

export type AssertDoneMatchesTarget = Assert<Same<(typeof done)[0], (typeof done)[1]>>;
export type AssertTimedDoneMatchesTarget = Assert<
  Same<(typeof timedDone)[0], (typeof timedDone)[1]>
>;
export type AssertVolatileDoneMatchesTarget = Assert<
  Same<(typeof volatileDone)[0], (typeof volatileDone)[1]>
>;
export type AssertUndefinedResponseMatchesTarget = Assert<
  Same<(typeof undefinedResponse)[0], (typeof undefinedResponse)[1]>
>;
export type AssertVoidResponseMatchesTarget = Assert<
  Same<(typeof voidResponse)[0], (typeof voidResponse)[1]>
>;
export type AssertBroadcastDoneMatchesTarget = Assert<
  Same<(typeof broadcastDone)[0], (typeof broadcastDone)[1]>
>;

void [done, timedDone, volatileDone, undefinedResponse, voidResponse, broadcastDone];

// Removing the old response-value filter must not admit events without an ack.
// @ts-expect-error an argument-free event has no acknowledgement
mockSocket.emitWithAck('noArguments');
// @ts-expect-error an argument-free event has no acknowledgement
realSocket.emitWithAck('noArguments');
// @ts-expect-error timeout does not give an argument-free event an acknowledgement
mockServer.timeout(100).emitWithAck('noArguments');
// @ts-expect-error timeout does not give an argument-free event an acknowledgement
realServer.timeout(100).emitWithAck('noArguments');
