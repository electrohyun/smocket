type NativeListener = (...args: unknown[]) => unknown;

interface NativeEventEmitterProbe {
  emit(event: string | symbol, ...args: unknown[]): boolean;
  on(event: 'removeListener', listener: NativeListener): unknown;
  removeAllListeners(): unknown;
}

interface NodeProcessHost {
  getBuiltinModule?(id: string): { EventEmitter?: new () => NativeEventEmitterProbe } | undefined;
}

function nativeEmitterEmitsFinalRemoveListenerMetaEvent(
  EventEmitter: new () => NativeEventEmitterProbe,
): boolean {
  const probe = new EventEmitter();
  const nativeEmit = probe.emit;
  let emitted = false;
  probe.emit = (event, ...args) => {
    if (event === 'removeListener') emitted = true;
    return nativeEmit.call(probe, event, ...args);
  };
  probe.on('removeListener', Boolean);
  probe.removeAllListeners();
  return emitted;
}

/** Detect the host's patch-level EventEmitter behavior without importing Node into browsers. */
export function hostEmitsFinalRemoveListenerMetaEvent(
  hostProcess: NodeProcessHost | null | undefined = (
    globalThis as typeof globalThis & { process?: NodeProcessHost }
  ).process,
): boolean {
  const EventEmitter = hostProcess?.getBuiltinModule?.('events')?.EventEmitter;
  return EventEmitter ? nativeEmitterEmitsFinalRemoveListenerMetaEvent(EventEmitter) : false;
}
