import type { CSSProperties } from 'react';

const BURSTS = [
  { x: 31, y: 40, delay: 0 },
  { x: 69, y: 32, delay: 0.26 },
  { x: 50, y: 55, delay: 0.5 },
];
const TINTS = ['var(--player)', 'var(--accent)', '#ffe9c4'];

let seed = 20260807;
const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const SPARKS = BURSTS.flatMap((burst, burstIndex) =>
  Array.from({ length: 16 }, (_, index) => {
    const angle = (index / 16) * Math.PI * 2 + (random() - 0.5) * 0.7;
    const reach = 44 + random() * 92;
    const dx = Math.cos(angle) * reach;
    const dy = Math.sin(angle) * reach;
    return {
      key: `${burstIndex}-${index}`,
      x: burst.x,
      y: burst.y,
      mx: dx * 0.58,
      my: dy * 0.58 - 7,
      dx,
      dy: dy + 44,
      delay: burst.delay + random() * 0.19,
      size: 3 + Math.round(random() * 3),
      tint: TINTS[(index + burstIndex) % TINTS.length],
    };
  }),
);

export default function Fireworks() {
  return (
    <div className="fireworks" aria-hidden="true">
      {SPARKS.map((spark) => (
        <span
          key={spark.key}
          style={
            {
              left: `${spark.x}%`,
              top: `${spark.y}%`,
              '--mx': `${spark.mx.toFixed(1)}px`,
              '--my': `${spark.my.toFixed(1)}px`,
              '--dx': `${spark.dx.toFixed(1)}px`,
              '--dy': `${spark.dy.toFixed(1)}px`,
              '--delay': `${spark.delay.toFixed(3)}s`,
              '--size': `${spark.size}px`,
              '--tint': spark.tint,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
