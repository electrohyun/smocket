import styles from './EventCall.module.css';

const eventPattern = /^(.*\.(?:emit|on)\()('[^']+')([\s\S]*)$/;
const socketPattern = /\b(?:socket|client)_([ABC])\b/g;

function SocketTokens({ code }: { code: string }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of code.matchAll(socketPattern)) {
    const index = match.index;
    parts.push(code.slice(cursor, index));
    parts.push(
      <span key={index} className={styles.socket} data-socket={match[1]}>
        {match[0]}
      </span>,
    );
    cursor = index + match[0].length;
  }

  parts.push(code.slice(cursor));
  return parts;
}

export default function EventCall({ code }: { code: string }) {
  const match = code.match(eventPattern);
  if (!match) return <SocketTokens code={code} />;

  return (
    <>
      <SocketTokens code={match[1]!} />
      <span className={styles.event}>{match[2]!}</span>
      <SocketTokens code={match[3]!} />
    </>
  );
}
