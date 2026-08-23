import { E as EventsMap, M as MessageEventParams } from './chunk-narrowed-support.js';

export interface Server<EmitEvents extends EventsMap> {
  send(...args: MessageEventParams<EmitEvents>): this;
}
