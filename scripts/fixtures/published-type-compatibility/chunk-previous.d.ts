interface EventsMap {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [event: string]: (...args: any[]) => void;
}
type EventName<Map extends EventsMap> = keyof Map & string;
type MessageEventParams<Map extends EventsMap> = Parameters<
  Map[Extract<'message', EventName<Map>>]
>;
type InternalOnly = string;

export interface Server<EmitEvents extends EventsMap> {
  send(...args: MessageEventParams<EmitEvents>): this;
}
