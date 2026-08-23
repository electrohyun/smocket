import { useEffect } from 'react';
import type { Label } from '../game/events.js';
import Fireworks from './Fireworks.js';

export default function Fanfare({
  word,
  winner,
  eyebrow,
  onDone,
}: {
  word: string;
  winner: Label;
  eyebrow: string;
  onDone(): void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, 2800);
    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <div className="fanfare" role="status" aria-live="polite" data-player={winner}>
      <Fireworks />
      <div className="fanfare-board">
        <p>{eyebrow}</p>
        <strong>{word}</strong>
      </div>
    </div>
  );
}
