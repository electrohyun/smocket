import { createRoot } from 'react-dom/client';
import { LABELS, type Label } from './game/events.js';
import GameApp from './ui/GameApp.js';
import './style.css';

const params = new URLSearchParams(location.search);
const requestedLabel = params.get('label');
const label: Label = LABELS.includes(requestedLabel as Label) ? (requestedLabel as Label) : 'A';
const recording = params.get('recording') === '1';
const room =
  params.get('room')?.match(/^[a-zA-Z0-9_-]{1,64}$/)?.[0] ??
  `${recording ? 'recording' : 'demo'}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;

if (params.get('room') !== room || params.get('label') !== label) {
  params.set('room', room);
  params.set('label', label);
  history.replaceState(null, '', `${location.pathname}?${params}`);
}

const root = document.querySelector('#root');
if (!root) throw new Error('Missing drawing-game root element');
createRoot(root).render(<GameApp room={room} label={label} recording={recording} />);
