import { useCallback, useEffect, useRef, useState } from 'react';
import { connectPage, GAME_TARGET } from '../connections/page-connection.js';
import {
  type ChatMessage,
  type GameClient,
  type JoinResult,
  type Label,
  type RoundResult,
  type SessionState,
  type StrokeSegment,
} from '../game/events.js';
import Canvas, { type CanvasHandle } from './Canvas.js';
import Countdown from './Countdown.js';
import Fanfare from './Fanfare.js';
import PlayerCard from './PlayerCard.js';
import TracePanel, { type TraceRow, type TraceRowInput } from './TracePanel.js';

const BUBBLE_MS = 3400;

function createPresence(room: string, label: Label): string {
  const key = `drawing-game:${room}:${label}`;
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const value = `${label.toLowerCase()}-${crypto.randomUUID().slice(0, 12)}`;
  sessionStorage.setItem(key, value);
  return value;
}

function hintFor(phase: SessionState['phase'] | 'waiting', isDrawer: boolean): string {
  if (phase === 'ended') {
    return 'One developer just reproduced a three-player realtime UI without a Socket.IO backend.';
  }
  if (phase === 'active') {
    return isDrawer
      ? 'Draw. The delivery record shows the real events observed by this tab.'
      : 'Guess from the drawing. The delivery record shows the real events observed by this tab.';
  }
  if (phase === 'countdown') return 'Three players are ready. The round starts together.';
  return 'Build and preview a three-player realtime UI before the backend is ready.';
}

export default function GameApp({
  room,
  label,
  recording,
}: {
  room: string;
  label: Label;
  recording: boolean;
}) {
  const [connected, setConnected] = useState(false);
  const [socketId, setSocketId] = useState('');
  const [admission, setAdmission] = useState<JoinResult | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [word, setWord] = useState<string>();
  const [winner, setWinner] = useState<RoundResult>();
  const [showFanfare, setShowFanfare] = useState(false);
  const [guess, setGuess] = useState('');
  const [guessAck, setGuessAck] = useState<'idle' | 'wrong' | 'correct' | 'error'>('idle');
  const [bubbles, setBubbles] = useState<Partial<Record<Label, string>>>({});
  const [receivedStrokes, setReceivedStrokes] = useState(0);
  const [events, setEvents] = useState<TraceRow[]>([]);
  const [error, setError] = useState<string>();
  const socketRef = useRef<GameClient | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);
  const nextEventId = useRef(1);
  const bubbleTimers = useRef<Partial<Record<Label, number>>>({});

  const record = useCallback((row: TraceRowInput) => {
    setEvents((current) => [...current.slice(-24), { ...row, id: nextEventId.current++ }]);
  }, []);

  const showChat = useCallback((message: ChatMessage) => {
    setBubbles((current) => ({ ...current, [message.from]: message.text }));
    window.clearTimeout(bubbleTimers.current[message.from]);
    bubbleTimers.current[message.from] = window.setTimeout(
      () => setBubbles((current) => ({ ...current, [message.from]: undefined })),
      BUBBLE_MS,
    );
  }, []);

  useEffect(
    () => () => {
      for (const timer of Object.values(bubbleTimers.current)) window.clearTimeout(timer);
    },
    [],
  );

  useEffect(() => {
    let live = true;
    const socket = connectPage(label, createPresence(room, label));
    socketRef.current = socket;
    record({ kind: 'lifecycle', text: `${label} connecting` });

    const join = async () => {
      record({ kind: 'inbound', event: 'join', value: room });
      const result = (await socket.emitWithAck('join', room)) as JoinResult;
      if (!live) return;
      record({ kind: 'ack', value: result });
      setAdmission(result);
    };
    const connectedNow = () => {
      if (!live) return;
      setConnected(true);
      setSocketId(socket.id ?? '');
      record({
        kind: 'lifecycle',
        text: `${label} connected · ${socket.id?.slice(0, 8) ?? 'socket'}`,
      });
      void join().catch((reason: unknown) => setError(String(reason)));
    };

    socket.on('connect', connectedNow);
    socket.on('connect_error', (reason) => {
      record({ kind: 'lifecycle', text: `${label} connect error · ${reason.message}` });
      setError(reason.message);
    });
    socket.on('bridge_error', (reason) => {
      record({ kind: 'lifecycle', text: `${label} bridge error · ${reason.message}` });
      setError(reason.message);
    });
    socket.on('disconnect', (reason) => {
      setConnected(false);
      record({ kind: 'lifecycle', text: `${label} disconnected · ${reason}` });
    });
    socket.on('session-state', (state) => {
      setSession(state);
      if (state.phase === 'ended' && state.winner && state.word) {
        setWinner({ winner: state.winner, word: state.word });
      }
      record({ kind: 'received', event: 'session-state', value: state });
    });
    socket.on('round-started', (result) =>
      record({ kind: 'received', event: 'round-started', value: result }),
    );
    socket.on('word', (value) => {
      setWord(value);
      record({ kind: 'received', event: 'word', value });
    });
    socket.on('stroke', (segment) => {
      canvasRef.current?.draw(segment);
      setReceivedStrokes((count) => count + 1);
      record({ kind: 'received', event: 'stroke', value: segment });
    });
    socket.on('chat', (message) => {
      showChat(message);
      record({ kind: 'received', event: 'chat', value: message });
    });
    socket.on('correct', (result) => record({ kind: 'received', event: 'correct', value: result }));
    socket.on('announce', (result) => {
      setWinner(result);
      setShowFanfare(true);
      record({ kind: 'received', event: 'announce', value: result });
    });
    if (socket.connected) connectedNow();

    return () => {
      live = false;
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [label, record, room, showChat]);

  const phase = session?.phase ?? 'waiting';
  const players = session?.players ?? [];
  const isDrawer = label === 'A';
  const admitted = admission?.accepted === true;
  const canDraw = connected && admitted && isDrawer && phase === 'active';
  const canGuess = connected && admitted && !isDrawer && phase === 'active';

  const sendStroke = useCallback(
    (stroke: StrokeSegment) => {
      socketRef.current?.emit('stroke', stroke);
      record({ kind: 'inbound', event: 'stroke', value: stroke });
    },
    [record],
  );

  const submitGuess = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = guess.trim();
    const socket = socketRef.current;
    if (!value || !socket || !canGuess) return;
    setGuess('');
    record({ kind: 'inbound', event: 'guess', value });
    try {
      const correct = (await socket.emitWithAck('guess', value)) as boolean;
      setGuessAck(correct ? 'correct' : 'wrong');
      record({ kind: 'ack', value: correct });
    } catch (reason) {
      setGuess(value);
      setGuessAck('error');
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const openPlayer = (nextLabel: 'B' | 'C') => {
    const url = new URL(location.href);
    url.searchParams.set('room', room);
    url.searchParams.set('label', nextLabel);
    record({ kind: 'lifecycle', text: `opening ${nextLabel}` });
    window.open(url, '_blank', 'noopener');
  };

  const admissionError =
    admission && !admission.accepted
      ? admission.reason === 'seat-occupied'
        ? 'This player is already open in another page.'
        : 'This session link could not be joined.'
      : undefined;

  return (
    <>
      <header className="brand">
        <img
          className="mascot"
          src="/cat.webp"
          alt="smocket mascot: a cool cat wearing sunglasses"
          width="26"
          height="26"
        />
        <span className="wordmark">smocket</span>
      </header>
      <div className="target-badge" data-target={GAME_TARGET} aria-label="Current target">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M8 4h11a2 2 0 0 1 2 2v10" />
          <path d="M6 7h11a2 2 0 0 1 2 2v9" />
          <rect x="3" y="10" width="14" height="10" rx="2" />
          <path d="M3 13h14" />
        </svg>
        {GAME_TARGET === 'smocket' ? 'MOCK · SHAREDWORKER' : 'REAL · SOCKET.IO'}
      </div>
      <aside className="player-badge" data-player={label} aria-label="Current player">
        <strong>{label}</strong>
        <span aria-hidden="true">·</span>
        <span>{isDrawer ? 'drawer' : 'guesser'}</span>
      </aside>

      <main
        className={`game${recording ? ' recording' : ''}`}
        data-testid="drawing-game"
        data-target={GAME_TARGET}
        data-room={room}
        data-label={label}
        data-socket-id={socketId}
        data-connected={connected}
        data-admitted={admitted}
        data-player-count={players.length}
        data-phase={phase}
        data-stroke-count={receivedStrokes}
        data-guess-ack={guessAck}
        data-ended={Boolean(winner)}
        data-winner={winner?.winner ?? ''}
      >
        <section className="board" aria-label={`${label} · ${isDrawer ? 'Drawer' : 'Guesser'}`}>
          {isDrawer && (
            <p className="secret">
              <span>word</span>
              <strong>{word ?? '…'}</strong>
            </p>
          )}
          <div className="canvas-wrap">
            <Canvas ref={canvasRef} disabled={!canDraw} onStroke={sendStroke} />
            {phase === 'waiting' && !error && !admissionError && (
              <div className="overlay waiting">
                <strong>{players.length} / 3 players connected</strong>
                <span>
                  Open the empty player desks below. The round starts when A, B, and C are ready.
                </span>
              </div>
            )}
            {phase === 'countdown' && session?.countdownEndsAt && (
              <Countdown endsAt={session.countdownEndsAt} />
            )}
            {(error || admissionError) && (
              <div className="overlay error" role="alert">
                <strong>Could not take {label}</strong>
                <span>{error ?? admissionError}</span>
              </div>
            )}
            {showFanfare && winner && (
              <Fanfare
                word={winner.word}
                winner={winner.winner}
                eyebrow={winner.winner === label ? 'You got it' : `${winner.winner} guessed it`}
                onDone={() => setShowFanfare(false)}
              />
            )}
            {winner && !showFanfare && (
              <div className="round-result" role="status">
                <strong data-player={winner.winner}>{winner.winner}</strong> guessed it —{' '}
                <b>{winner.word}</b>
              </div>
            )}
          </div>

          <div className="players" aria-label="Player pages">
            {(['B', 'C'] as const).map((playerLabel) => (
              <PlayerCard
                key={playerLabel}
                label={playerLabel}
                current={label}
                player={players.find((player) => player.label === playerLabel)}
                bubble={bubbles[playerLabel]}
                winner={winner?.winner}
                onOpen={openPlayer}
              />
            ))}
          </div>

          {!isDrawer && (
            <form className="guess" onSubmit={(event) => void submitGuess(event)}>
              <input
                value={guess}
                onChange={(event) => setGuess(event.target.value)}
                placeholder={
                  winner ? `Round over · the word was ${winner.word}` : 'Guess from the drawing'
                }
                aria-label="Guess"
                disabled={!canGuess}
              />
              <button type="submit" disabled={!canGuess || !guess.trim()}>
                Send
              </button>
              <output aria-live="polite">
                {guessAck === 'wrong'
                  ? 'Guess acknowledged — keep trying.'
                  : guessAck === 'correct'
                    ? 'Correct guess acknowledged.'
                    : guessAck === 'error'
                      ? 'Guess acknowledgement failed.'
                      : ''}
              </output>
            </form>
          )}

          <footer>
            <p>{hintFor(phase, isDrawer)}</p>
            <code title={room}>SESSION ID: {room}</code>
          </footer>
        </section>

        <TracePanel rows={events} scope={label} />
      </main>
    </>
  );
}
