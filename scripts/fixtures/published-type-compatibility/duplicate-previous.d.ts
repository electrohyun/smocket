import type { Payload as FirstPayload } from './duplicate-previous-first.js';
import type { Payload as SecondPayload } from './duplicate-previous-second.js';

export interface Socket {
  first(value: FirstPayload): void;
  second(value: SecondPayload): void;
}
