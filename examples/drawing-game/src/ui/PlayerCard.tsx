import type { Label, Player } from '../game/events.js';

export default function PlayerCard({
  label,
  current,
  player,
  bubble,
  winner,
  onOpen,
}: {
  label: 'B' | 'C';
  current: Label;
  player?: Player;
  bubble?: string;
  winner?: Label;
  onOpen(label: 'B' | 'C'): void;
}) {
  const ready = Boolean(player);
  return (
    <div
      className="player-card"
      data-player={label}
      data-ready={ready}
      data-current={current === label}
    >
      <article className={`character${winner === label ? ' winner' : ''}`} data-socket={label}>
        {bubble && <div className="bubble">{bubble}</div>}
        <svg className="person" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="19" r="11" />
          <rect x="15" y="33" width="34" height="26" rx="11" />
        </svg>
        <div className="desk" />
        <p>
          <span className="player-dot" />
          {label} · {current === label ? 'you' : ready ? 'guesser' : 'waiting'}
        </p>
      </article>
      {ready ? (
        <span className="ready">ready</span>
      ) : current === 'A' ? (
        <button className="open-player" type="button" onClick={() => onOpen(label)}>
          Open Player {label === 'B' ? '2' : '3'}
        </button>
      ) : (
        <span className="waiting-player">Waiting for Player {label === 'B' ? '2' : '3'}</span>
      )}
    </div>
  );
}
