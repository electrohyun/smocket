import { io } from 'socket.io-client';
import type { GameClient, Label } from '../game/events.js';

export function connectToSocketIo(label: Label, presenceId: string): GameClient {
  return io(location.origin, {
    auth: { label, presenceId },
    forceNew: true,
  }) as unknown as GameClient;
}
