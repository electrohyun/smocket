import type { Payload } from '../dependency.js';

export interface Socket {
  send(value: Payload): void;
  load(): typeof import('../dependency.js');
}
