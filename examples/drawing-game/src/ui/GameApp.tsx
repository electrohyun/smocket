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
import PlayerCard from './PlayerCard.js';

interface EventRow {
  id: number;
  event: string;
  detail: string;
  direction: 'in' | 'out' | 'ack';
}

function createPresence(room: string, label: Label): string {
  const key = `drawing-game:${room}:${label}`;
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const value = `${label.toLowerCase()}-${crypto.randomUUID().slice(0, 12)}`;
  sessionStorage.setItem(key, value);
  return value;
}

function summarize(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value).replaceAll('"', '');
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
  const [guess, setGuess] = useState('');
  const [guessAck, setGuessAck] = useState<'idle' | 'wrong' | 'correct'>('idle');
  const [bubbles, setBubbles] = useState<Partial<Record<Label, string>>>({});
  const [receivedStrokes, setReceivedStrokes] = useState(0);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string>();
  const socketRef = useRef<GameClient | null>(null);
  const canvasRef = useRef<CanvasHandle>(null);
  const nextEventId = useRef(1);

  const record = useCallback((direction: EventRow['direction'], event: string, detail: unknown) => {
    setEvents((current) => [
      ...current.slice(-24),
      { id: nextEventId.current++, direction, event, detail: summarize(detail) },
    ]);
  }, []);

  const showChat = useCallback((message: ChatMessage) => {
    setBubbles((current) => ({ ...current, [message.from]: message.text }));
    window.setTimeout(
      () => setBubbles((current) => ({ ...current, [message.from]: undefined })),
      3200,
    );
  }, []);

  useEffect(() => {
    let live = true;
    const socket = connectPage(label, createPresence(room, label));
    socketRef.current = socket;

    const join = async () => {
      record('out', 'join', room);
      const result = (await socket.emitWithAck('join', room)) as JoinResult;
      if (!live) return;
      record('ack', 'join', result);
      setAdmission(result);
    };
    const connectedNow = () => {
      if (!live) return;
      setConnected(true);
      setSocketId(socket.id ?? '');
      record('in', 'connect', socket.id ?? 'socket');
      void join().catch((reason: unknown) => setError(String(reason)));
    };

    socket.on('connect', connectedNow);
    socket.on('connect_error', (reason) => setError(reason.message));
    socket.on('bridge_error', (reason) => setError(reason.message));
    socket.on('disconnect', (reason) => {
      setConnected(false);
      record('in', 'disconnect', reason);
    });
    socket.on('session-state', (state) => {
      setSession(state);
      if (state.phase === 'ended' && state.winner && state.word) {
        setWinner({ winner: state.winner, word: state.word });
      }
      record('in', 'session-state', `${state.players.length} players · ${state.phase}`);
    });
    socket.on('round-started', (result) => record('in', 'round-started', result));
    socket.on('word', (value) => {
      setWord(value);
      record('in', 'word', value);
    });
    socket.on('stroke', (segment) => {
      canvasRef.current?.draw(segment);
      setReceivedStrokes((count) => count + 1);
      record('in', 'stroke', `#${segment.id}${segment.end ? ' end' : ''}`);
    });
    socket.on('chat', (message) => {
      showChat(message);
      record('in', 'chat', `${message.from}: ${message.text}`);
    });
    socket.on('correct', (result) => record('in', 'correct', result));
    socket.on('announce', (result) => {
      setWinner(result);
      record('in', 'announce', `${result.winner} · ${result.word}`);
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
      record('out', 'stroke', `#${stroke.id}${stroke.end ? ' end' : ''}`);
    },
    [record],
  );

  const submitGuess = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = guess.trim();
    const socket = socketRef.current;
    if (!value || !socket || !canGuess) return;
    setGuess('');
    record('out', 'guess', value);
    const correct = (await socket.emitWithAck('guess', value)) as boolean;
    setGuessAck(correct ? 'correct' : 'wrong');
    record('ack', 'guess', correct);
  };

  const openPlayer = (nextLabel: 'B' | 'C') => {
    const url = new URL(location.href);
    url.searchParams.set('room', room);
    url.searchParams.set('label', nextLabel);
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
      <header className="topbar">
        <a className="brand" href="/" aria-label="Start a new drawing game">
          smocket
        </a>
        <div className="target-badge" data-target={GAME_TARGET}>
          {GAME_TARGET === 'smocket' ? 'MOCK · SHAREDWORKER' : 'REAL · SOCKET.IO'}
        </div>
        <div className="player-badge" data-player={label}>
          {label} · {isDrawer ? 'DRAWER' : 'GUESSER'}
        </div>
      </header>

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
        <section className="board" aria-label={`${label} game view`}>
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
                <span>Open the empty player desks below.</span>
              </div>
            )}
            {phase === 'countdown' && session?.countdownEndsAt && (
              <Countdown endsAt={session.countdownEndsAt} />
            )}
            {(error || admissionError) && (
              <div className="overlay error" role="alert">
                <strong>Could not connect Player {label}</strong>
                <span>{error ?? admissionError}</span>
              </div>
            )}
            {winner && (
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
                placeholder="Guess from the drawing"
                aria-label="Guess"
                disabled={!canGuess}
              />
              <button type="submit" disabled={!canGuess || !guess.trim()}>
                Send
              </button>
              <output aria-live="polite">
                {guessAck === 'wrong'
                  ? 'Acknowledged — keep trying.'
                  : guessAck === 'correct'
                    ? 'Correct guess acknowledged.'
                    : ''}
              </output>
            </form>
          )}

          <footer>
            {!recording && (
              <p>
                {phase === 'active'
                  ? isDrawer
                    ? 'Draw for the two guessers.'
                    : 'Your guess is acknowledged by the same game handler.'
                  : 'One game, three real browser pages.'}
              </p>
            )}
            <code title={room}>SESSION ID: {room}</code>
          </footer>
        </section>

        <aside className="deliveries" aria-label={`Events received by Player ${label}`}>
          <div className="delivery-heading">
            <h2>Delivery</h2>
            <span data-player={label}>(ONLY {label})</span>
          </div>
          <ol>
            {events.map((row) => (
              <li key={row.id} data-direction={row.direction}>
                <span>{row.direction}</span>
                <strong>{row.event}</strong>
                <code>{row.detail}</code>
              </li>
            ))}
          </ol>
        </aside>
      </main>
    </>
  );
}
