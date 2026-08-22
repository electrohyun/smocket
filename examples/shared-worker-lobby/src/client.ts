import { connectSharedWorker } from 'smocket-client/shared-worker';
import {
  LOBBY_URL,
  type ClientToServerEvents,
  type LobbyState,
  type ServerToClientEvents,
} from './application';
import './style.css';

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing example element: ${selector}`);
  return found;
}

function requireSharedWorker(): typeof SharedWorker {
  if (typeof SharedWorker !== 'function') {
    throw new Error('This preview requires browser SharedWorker support');
  }
  return SharedWorker;
}

const label = new URLSearchParams(location.search).get('label')?.trim() || 'A';
const labelNode = element<HTMLSpanElement>('#label');
const connectionNode = element<HTMLParagraphElement>('#connection');
const socketIdNode = element<HTMLElement>('#socket-id');
const playersNode = element<HTMLUListElement>('#players');
const readyButton = element<HTMLButtonElement>('#ready');
const startButton = element<HTMLButtonElement>('#start');
const noticeNode = element<HTMLParagraphElement>('#notice');
labelNode.textContent = label;

try {
  const SharedWorkerConstructor = requireSharedWorker();
  const worker = new SharedWorkerConstructor(new URL('./worker.ts', import.meta.url), {
    name: 'smocket-shared-worker-lobby-v1',
    type: 'module',
  });
  const socket = connectSharedWorker<ServerToClientEvents, ClientToServerEvents>(worker.port, {
    url: LOBBY_URL,
    auth: { label },
  });

  socket.on('connect', () => {
    document.body.dataset.connected = 'true';
    connectionNode.textContent = 'Connected to the shared in-browser server.';
    socketIdNode.textContent = socket.id ?? 'unknown';
  });

  socket.on('connect_error', (error) => {
    connectionNode.textContent = error.message;
  });

  socket.on('lobby-state', (state: LobbyState) => {
    document.body.dataset.playerCount = String(state.players.length);
    document.body.dataset.canStart = String(state.canStart);
    playersNode.replaceChildren(
      ...state.players.map((player) => {
        const item = document.createElement('li');
        item.textContent = `${player.label}${player.leader ? ' · leader' : ''} — ${player.ready ? 'ready' : 'waiting'}`;
        return item;
      }),
    );
    const current = state.players.find((player) => player.id === socket.id);
    startButton.disabled = !(state.canStart && current?.leader);
    noticeNode.textContent = state.canStart ? 'The leader can start.' : 'Waiting for everyone.';
  });

  socket.on('game-started', ({ by }) => {
    document.body.dataset.startedBy = by;
    noticeNode.textContent = `Game started by ${by}.`;
  });

  readyButton.addEventListener('click', async () => {
    const result = await socket.emitWithAck('ready');
    if (result.accepted) readyButton.disabled = true;
  });

  startButton.addEventListener('click', async () => {
    const result = await socket.emitWithAck('start-game');
    if (!result.accepted) noticeNode.textContent = 'Only the ready leader can start.';
  });
} catch (error) {
  document.body.dataset.unsupported = 'true';
  connectionNode.textContent = error instanceof Error ? error.message : String(error);
}
