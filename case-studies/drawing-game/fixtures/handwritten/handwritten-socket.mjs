// [maintenance-snippet:start base-single-client]
export const HANDWRITTEN_FEATURE_IDS = [
  'multiple-clients',
  'room-broadcast',
  'sender-exclusion',
  'acknowledgement',
  'targeted-delivery',
  'disconnect-cleanup',
];

const origins = new Map();

function createListenerStore() {
  return { events: new Map(), any: [] };
}

function addListener(store, event, listener, once = false) {
  const listeners = store.events.get(event) ?? [];
  listeners.push({ listener, once });
  store.events.set(event, listeners);
}

function removeListener(store, event, listener) {
  const listeners = store.events.get(event);
  if (!listeners) return;
  store.events.set(
    event,
    listeners.filter((entry) => entry.listener !== listener),
  );
}

function dispatch(store, event, args) {
  for (const listener of [...store.any]) listener(event, ...args);
  const listeners = [...(store.events.get(event) ?? [])];
  for (const entry of listeners) {
    if (entry.once) removeListener(store, event, entry.listener);
    entry.listener(...args);
  }
}

function attachListenerApi(target, store) {
  return Object.assign(target, {
    on(event, listener) {
      addListener(store, event, listener);
      return target;
    },
    once(event, listener) {
      addListener(store, event, listener, true);
      return target;
    },
    off(event, listener) {
      removeListener(store, event, listener);
      return target;
    },
    onAny(listener) {
      store.any.push(listener);
      return target;
    },
  });
}

function createBaseState(origin, featureIds) {
  const state = {
    origin,
    featureIds,
    nextSocketId: 0,
    singlePair: undefined,
    serverListeners: createListenerStore(),
    registerPair(pair) {
      if (state.singlePair) throw new Error('The base handwritten stage supports one client.');
      pair.id = 'handwritten-single';
      state.singlePair = pair;
    },
    listPairs() {
      return state.singlePair ? [state.singlePair] : [];
    },
    findPair(socketId) {
      return state.singlePair?.id === socketId ? state.singlePair : undefined;
    },
    removePair(pair) {
      if (state.singlePair === pair) state.singlePair = undefined;
    },
    resetConnections() {
      state.singlePair = undefined;
    },
    prepareClientArguments(args) {
      return args.filter((argument) => typeof argument !== 'function');
    },
    filterRecipients(pairs) {
      return pairs;
    },
    selectRecipients() {
      throw new Error('Room or socket targeting is not enabled for this stage.');
    },
    route(target, senderId, event, args) {
      const selected = state.selectRecipients(target);
      const recipients = state.filterRecipients(selected, senderId);
      for (const pair of recipients) dispatch(pair.clientListeners, event, args);
    },
    join() {
      throw new Error('Room membership is not enabled for this stage.');
    },
    leaveAllRooms() {},
    resetRooms() {},
    disconnectPair(pair, reason) {
      if (!pair.client.connected) return;
      pair.client.connected = false;
      pair.serverSocket.connected = false;
      dispatch(pair.serverListeners, 'disconnect', [reason]);
      dispatch(pair.clientListeners, 'disconnect', [reason]);
    },
  };
  return state;
}

function installFeatures(state) {
  if (state.featureIds.has('multiple-clients')) installMultipleClients(state);
  if (state.featureIds.has('room-broadcast')) installRoomBroadcast(state);
  if (state.featureIds.has('sender-exclusion')) installSenderExclusion(state);
  if (state.featureIds.has('acknowledgement')) installAcknowledgement(state);
  if (state.featureIds.has('targeted-delivery')) installTargetedDelivery(state);
  if (state.featureIds.has('disconnect-cleanup')) installDisconnectCleanup(state);
}

function createPair(state, auth) {
  const clientListeners = createListenerStore();
  const serverListeners = createListenerStore();
  const pair = {
    id: '',
    client: undefined,
    serverSocket: undefined,
    clientListeners,
    serverListeners,
  };

  const client = attachListenerApi(
    {
      id: '',
      connected: true,
      emit(event, ...args) {
        dispatch(serverListeners, event, state.prepareClientArguments(args));
        return client;
      },
      disconnect() {
        state.disconnectPair(pair, 'client namespace disconnect');
        return client;
      },
    },
    clientListeners,
  );
  const serverSocket = attachListenerApi(
    {
      id: '',
      connected: true,
      handshake: { auth: { ...auth } },
      emit(event, ...args) {
        dispatch(clientListeners, event, args);
        return true;
      },
      async join(room) {
        state.join(pair, room);
      },
      to(target) {
        return createBroadcastOperator(state, target, pair.id);
      },
      disconnect() {
        state.disconnectPair(pair, 'server namespace disconnect');
        return serverSocket;
      },
    },
    serverListeners,
  );

  pair.client = client;
  pair.serverSocket = serverSocket;
  state.registerPair(pair);
  client.id = pair.id;
  serverSocket.id = pair.id;
  dispatch(state.serverListeners, 'connection', [serverSocket]);
  dispatch(clientListeners, 'connect', []);
  return client;
}

function createBroadcastOperator(state, target, senderId) {
  return {
    emit(event, ...args) {
      state.route(target, senderId, event, args);
      return true;
    },
  };
}

export class Server {
  constructor(origin, options = {}) {
    if (origins.has(origin)) throw new Error(`A handwritten server already owns ${origin}`);
    const featureIds = new Set(options.features ?? HANDWRITTEN_FEATURE_IDS);
    for (const featureId of featureIds) {
      if (!HANDWRITTEN_FEATURE_IDS.includes(featureId)) {
        throw new Error(`Unknown handwritten feature: ${featureId}`);
      }
    }
    this.state = createBaseState(origin, featureIds);
    installFeatures(this.state);
    origins.set(origin, this.state);
  }

  on(event, listener) {
    addListener(this.state.serverListeners, event, listener);
    return this;
  }

  emit(event, ...args) {
    for (const pair of this.state.listPairs()) dispatch(pair.clientListeners, event, args);
    return true;
  }

  to(target) {
    return createBroadcastOperator(this.state, target, undefined);
  }

  async close() {
    for (const pair of [...this.state.listPairs()]) {
      this.state.disconnectPair(pair, 'server shutting down');
    }
    this.state.resetConnections();
    this.state.resetRooms();
    origins.delete(this.state.origin);
  }
}

export function io(origin, options = {}) {
  const state = origins.get(origin);
  if (!state) throw new Error(`No handwritten server is registered for ${origin}`);
  return createPair(state, options.auth ?? {});
}
// [maintenance-snippet:end base-single-client]

// [maintenance-snippet:start multiple-clients]
function installMultipleClients(state) {
  const connections = new Map();
  state.registerPair = (pair) => {
    state.nextSocketId += 1;
    pair.id = `handwritten-${state.nextSocketId}`;
    connections.set(pair.id, pair);
  };
  state.listPairs = () => [...connections.values()];
  state.findPair = (socketId) => connections.get(socketId);
  state.removePair = (pair) => connections.delete(pair.id);
  state.resetConnections = () => connections.clear();
}
// [maintenance-snippet:end multiple-clients]

// [maintenance-snippet:start room-broadcast]
function installRoomBroadcast(state) {
  const rooms = new Map();
  state.join = (pair, room) => {
    const members = rooms.get(room) ?? new Set();
    members.add(pair.id);
    rooms.set(room, members);
  };
  state.selectRecipients = (room) =>
    [...(rooms.get(room) ?? [])]
      .map((socketId) => state.findPair(socketId))
      .filter((pair) => pair?.client.connected);
  state.leaveAllRooms = (pair) => {
    for (const members of rooms.values()) members.delete(pair.id);
  };
  state.resetRooms = () => rooms.clear();
}
// [maintenance-snippet:end room-broadcast]

// [maintenance-snippet:start sender-exclusion]
function installSenderExclusion(state) {
  state.filterRecipients = (pairs, senderId) =>
    senderId === undefined ? pairs : pairs.filter((pair) => pair.id !== senderId);
}
// [maintenance-snippet:end sender-exclusion]

// [maintenance-snippet:start acknowledgement]
function installAcknowledgement(state) {
  state.prepareClientArguments = (args) => args;
}
// [maintenance-snippet:end acknowledgement]

// [maintenance-snippet:start targeted-delivery]
function installTargetedDelivery(state) {
  const selectRoomRecipients = state.selectRecipients;
  state.selectRecipients = (target) => {
    const socket = state.findPair(target);
    return socket?.client.connected ? [socket] : selectRoomRecipients(target);
  };
}
// [maintenance-snippet:end targeted-delivery]

// [maintenance-snippet:start disconnect-cleanup]
function installDisconnectCleanup(state) {
  const disconnectWithoutCleanup = state.disconnectPair;
  state.disconnectPair = (pair, reason) => {
    if (!pair.client.connected) return;
    disconnectWithoutCleanup(pair, reason);
    state.leaveAllRooms(pair);
    state.removePair(pair);
  };
}
// [maintenance-snippet:end disconnect-cleanup]
