import { useEffect, useState } from 'react';

export default function Countdown({ endsAt }: { endsAt: number }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(1, Math.ceil((endsAt - Date.now()) / 1000)),
  );

  useEffect(() => {
    const update = () => setRemaining(Math.max(1, Math.ceil((endsAt - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  return (
    <div
      className="countdown"
      role="timer"
      aria-label={`Round starts in ${remaining} ${remaining === 1 ? 'second' : 'seconds'}`}
    >
      <strong>{remaining}</strong>
    </div>
  );
}
