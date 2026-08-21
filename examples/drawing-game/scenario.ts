import {
  LABELS,
  WORD,
  type ChatMessage,
  type JoinResult,
  type Label,
  type RoundResult,
  type StrokeSegment,
} from './application.js';
import {
  createDrawingGameClient,
  joinGame,
  receiveAnnouncement,
  receiveChat,
  receiveCorrect,
  receiveStrokes,
  sendStroke,
  submitGuess,
  waitForConnection,
  type DrawingGameClient,
} from './client.js';

export const SCENARIO_MARKER = 'drawing-game:marker';

export interface RecordedEvent {
  event: 'stroke' | 'chat' | 'correct' | 'announce';
  payload: StrokeSegment | ChatMessage | { word: string } | RoundResult;
}

export interface ScenarioObservation {
  connections: Array<{ label: Label; socketId: string }>;
  distinctSocketIds: boolean;
  joins: Array<{ label: Label; acknowledgement: JoinResult }>;
  events: Record<Label, RecordedEvent[]>;
  acknowledgements: Array<{ from: Label; value: boolean }>;
  deliveries: Array<{
    event: RecordedEvent['event'];
    payload: RecordedEvent['payload'];
    recipients: Label[];
    senderExcluded?: Label;
    disconnected?: Label[];
  }>;
  disconnect: {
    label: Label;
    serverObserved: boolean;
    connectedAfter: boolean;
    remaining: Label[];
  };
}

export interface ScenarioApplication {
  url: string;
  barrier(client: DrawingGameClient, token: string): void;
  waitForDisconnect(label: Label): Promise<void>;
  close(): Promise<void>;
}

export interface ScenarioTarget {
  id: 'socket.io' | 'smocket';
  start(): Promise<ScenarioApplication> | ScenarioApplication;
}

interface ClientObservation {
  events: RecordedEvent[];
  waitForMarker(token: string): Promise<void>;
}

function observeClient(client: DrawingGameClient): ClientObservation {
  const events: RecordedEvent[] = [];
  const markerWaiters = new Map<string, () => void>();

  receiveStrokes(client, (payload) => events.push({ event: 'stroke', payload }));
  receiveChat(client, (payload) => events.push({ event: 'chat', payload }));
  receiveCorrect(client, (word) => events.push({ event: 'correct', payload: { word } }));
  receiveAnnouncement(client, (payload) => events.push({ event: 'announce', payload }));
  client.onAny((event, token: unknown) => {
    if (event !== SCENARIO_MARKER || typeof token !== 'string') return;
    markerWaiters.get(token)?.();
    markerWaiters.delete(token);
  });

  return {
    events,
    waitForMarker(token) {
      return new Promise((resolve) => markerWaiters.set(token, resolve));
    },
  };
}

function recipients(
  observers: Record<Label, ClientObservation>,
  event: RecordedEvent['event'],
  matches: (payload: RecordedEvent['payload']) => boolean,
): Label[] {
  return LABELS.filter((label) =>
    observers[label].events.some((entry) => entry.event === event && matches(entry.payload)),
  );
}

async function crossBarrier(
  application: ScenarioApplication,
  sender: DrawingGameClient,
  observers: Record<Label, ClientObservation>,
  labels: readonly Label[],
  token: string,
): Promise<void> {
  const received = labels.map((label) => observers[label].waitForMarker(token));
  application.barrier(sender, token);
  await Promise.all(received);
}

export async function runDrawingGameScenario(target: ScenarioTarget): Promise<ScenarioObservation> {
  const application = await target.start();
  const clients = {} as Record<Label, DrawingGameClient>;

  try {
    for (const label of LABELS) clients[label] = createDrawingGameClient(application.url, label);

    const observers = Object.fromEntries(
      LABELS.map((label) => [label, observeClient(clients[label])]),
    ) as Record<Label, ClientObservation>;

    await Promise.all(LABELS.map((label) => waitForConnection(clients[label])));

    const actualIds = LABELS.map((label) => {
      const socketId = clients[label].id;
      if (!socketId) throw new Error(`Connected client ${label} has no socket id`);
      return socketId;
    });

    const joins: ScenarioObservation['joins'] = [];
    for (const label of LABELS) {
      const acknowledgement = await joinGame(clients[label]);
      joins.push({ label, acknowledgement });
    }

    const firstStroke: StrokeSegment = {
      id: 1,
      points: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    };
    sendStroke(clients.A, firstStroke);
    await crossBarrier(application, clients.A, observers, LABELS, 'after-first-stroke');

    const wrongText = 'zebra';
    const wrongAcknowledgement = await submitGuess(clients.B, wrongText);
    await crossBarrier(application, clients.B, observers, LABELS, 'after-wrong-guess');

    const correctAcknowledgement = await submitGuess(clients.C, WORD);
    await crossBarrier(application, clients.C, observers, LABELS, 'after-correct-guess');

    // [snippet:start disconnect-behavior]
    const serverDisconnected = application.waitForDisconnect('C');
    clients.C.disconnect();
    await serverDisconnected;

    const secondStroke: StrokeSegment = {
      id: 2,
      points: [[0.5, 0.6]],
      end: true,
    };
    sendStroke(clients.A, secondStroke);
    await crossBarrier(application, clients.A, observers, ['A', 'B'], 'after-disconnect-stroke');
    // [snippet:end disconnect-behavior]

    const wrongChat: ChatMessage = { from: 'B', text: wrongText };
    const correct = { word: WORD };
    const announcement: RoundResult = { winner: 'C', word: WORD };

    return {
      connections: LABELS.map((label) => ({
        label,
        socketId: `sid_${label}`,
      })),
      distinctSocketIds: new Set(actualIds).size === LABELS.length,
      joins,
      events: Object.fromEntries(
        LABELS.map((label) => [label, [...observers[label].events]]),
      ) as Record<Label, RecordedEvent[]>,
      acknowledgements: [
        { from: 'B', value: wrongAcknowledgement },
        { from: 'C', value: correctAcknowledgement },
      ],
      deliveries: [
        {
          event: 'stroke',
          payload: firstStroke,
          recipients: recipients(
            observers,
            'stroke',
            (payload) => (payload as StrokeSegment).id === firstStroke.id,
          ),
          senderExcluded: 'A',
        },
        {
          event: 'chat',
          payload: wrongChat,
          recipients: recipients(
            observers,
            'chat',
            (payload) => (payload as ChatMessage).text === wrongText,
          ),
        },
        {
          event: 'correct',
          payload: correct,
          recipients: recipients(observers, 'correct', () => true),
        },
        {
          event: 'announce',
          payload: announcement,
          recipients: recipients(observers, 'announce', () => true),
        },
        {
          event: 'stroke',
          payload: secondStroke,
          recipients: recipients(
            observers,
            'stroke',
            (payload) => (payload as StrokeSegment).id === secondStroke.id,
          ),
          senderExcluded: 'A',
          disconnected: ['C'],
        },
      ],
      disconnect: {
        label: 'C',
        serverObserved: true,
        connectedAfter: clients.C.connected,
        remaining: LABELS.filter((label) => clients[label].connected),
      },
    };
  } finally {
    for (const client of Object.values(clients)) {
      if (client.connected) client.disconnect();
    }
    await application.close();
  }
}
