import { useEffect, useRef } from 'react';
import type { Label } from '../game/events.js';
import EventCall from './EventCall.js';
import styles from './TracePanel.module.css';

export type TraceRow =
  | { id: number; kind: 'inbound' | 'received'; event: string; value?: unknown }
  | { id: number; kind: 'ack'; value: unknown }
  | { id: number; kind: 'lifecycle'; text: string };

export type TraceRowInput =
  | { kind: 'inbound' | 'received'; event: string; value?: unknown }
  | { kind: 'ack'; value: unknown }
  | { kind: 'lifecycle'; text: string };

interface FoldedRow {
  row: TraceRow;
  count: number;
}

function foldRows(rows: readonly TraceRow[]): FoldedRow[] {
  const folded: FoldedRow[] = [];
  for (const row of rows) {
    const previous = folded.at(-1);
    if (
      previous?.row.kind === row.kind &&
      (row.kind === 'inbound' || row.kind === 'received') &&
      row.event === 'stroke' &&
      previous.row.kind !== 'ack' &&
      previous.row.kind !== 'lifecycle' &&
      previous.row.event === row.event
    ) {
      previous.row = row;
      previous.count += 1;
    } else {
      folded.push({ row, count: 1 });
    }
  }
  return folded;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  if (value === null || typeof value !== 'object') return String(value);
  return '{…}';
}

function formatCall(row: Extract<TraceRow, { kind: 'inbound' | 'received' }>, label: Label) {
  const receiver = row.kind === 'inbound' ? `client_${label}.emit` : `socket_${label}.on`;
  const payload = row.value === undefined ? '' : `, ${formatValue(row.value)}`;
  return `${receiver}('${row.event}'${payload})`;
}

export default function TracePanel({ rows, scope }: { rows: TraceRow[]; scope: Label }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [rows]);
  const folded = foldRows(rows);

  return (
    <aside className={styles.panel} aria-label="Delivery record">
      <header className={styles.head}>
        <span className={styles.title}>
          delivery{' '}
          <span className={styles.scope} data-socket={scope}>
            (only {scope})
          </span>
        </span>
        <ul className={styles.legend}>
          <li className={styles.chip} data-socket={scope}>
            {scope}
          </li>
        </ul>
      </header>

      <div className={styles.log} ref={scrollRef}>
        {folded.map(({ row, count }) => {
          if (row.kind === 'lifecycle') {
            return (
              <div key={row.id} className={`${styles.row} ${styles.note}`} data-kind="lifecycle">
                {row.text}
              </div>
            );
          }
          if (row.kind === 'ack') {
            return (
              <div key={row.id} className={`${styles.row} ${styles.ack}`} data-kind="ack">
                ← ack {scope} {formatValue(row.value)}
              </div>
            );
          }
          return (
            <div key={row.id} className={styles.row} data-event={row.event} data-count={count}>
              <div className={styles.call}>
                <EventCall code={formatCall(row, scope)} />
                {count > 1 && <span className={styles.count}> ×{count}</span>}
              </div>
              <div className={styles.reach}>{row.kind === 'inbound' ? '→ server' : '← server'}</div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
