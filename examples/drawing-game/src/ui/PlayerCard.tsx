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
    <article
      className="player-card"
      data-player={label}
      data-ready={ready}
      data-current={current === label}
    >
      {bubble && <div className="bubble">{bubble}</div>}
      <div className={`person${winner === label ? ' winner' : ''}`} aria-hidden="true">
        <span className="head" />
        <span className="body" />
      </div>
      <div className="desk" />
      <p>
        <span className="player-dot" /> {label} ·{' '}
        {current === label ? 'you' : ready ? 'guesser' : 'waiting'}
      </p>
      {ready ? (
        <span className="ready">ready</span>
      ) : current === 'A' ? (
        <button className="open-player" type="button" onClick={() => onOpen(label)}>
          Open Player {label === 'B' ? '2' : '3'}
        </button>
      ) : (
        <span className="waiting-player">Waiting for Player {label === 'B' ? '2' : '3'}</span>
      )}
    </article>
  );
}
