import type { Payload as FirstPayload } from './duplicate-candidate-first.js';
import type { Payload as SecondPayload } from './duplicate-candidate-second.js';

export interface Socket {
  first(value: FirstPayload): void;
  second(value: SecondPayload): void;
}
