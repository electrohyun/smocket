import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { StrokeSegment } from '../game/events.js';

export interface CanvasHandle {
  draw(segment: StrokeSegment): void;
}

interface CanvasProps {
  disabled: boolean;
  onStroke(segment: StrokeSegment): void;
}

function DrawingCanvas(
  { disabled, onStroke }: CanvasProps,
  forwardedRef: React.ForwardedRef<CanvasHandle>,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<StrokeSegment[]>([]);
  const activeRef = useRef<{ id: number; last: [number, number] } | null>(null);
  const nextIdRef = useRef(1);

  const paint = useCallback((segment: StrokeSegment, remember = true) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    if (remember) historyRef.current.push(segment);
    const rect = canvas.getBoundingClientRect();
    context.beginPath();
    segment.points.forEach(([x, y], index) => {
      const px = x * rect.width;
      const py = y * rect.height;
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.stroke();
  }, []);

  useImperativeHandle(forwardedRef, () => ({ draw: paint }), [paint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const context = canvas.getContext('2d');
      if (!context) return;
      const rect = canvas.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * scale);
      canvas.height = Math.round(rect.height * scale);
      context.scale(scale, scale);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = 2.5;
      context.strokeStyle = getComputedStyle(canvas).getPropertyValue('--ink').trim() || '#e9ebf4';
      for (const segment of historyRef.current) paint(segment, false);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [paint]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    ];
  };

  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activeRef.current = { id: nextIdRef.current++, last: point(event) };
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const active = activeRef.current;
    if (!active) return;
    const next = point(event);
    const segment: StrokeSegment = { id: active.id, points: [active.last, next] };
    active.last = next;
    paint(segment);
    onStroke(segment);
  };

  const up = () => {
    const active = activeRef.current;
    if (!active) return;
    const segment: StrokeSegment = { id: active.id, points: [active.last], end: true };
    activeRef.current = null;
    paint(segment);
    onStroke(segment);
  };

  return (
    <canvas
      ref={canvasRef}
      className="drawing-surface"
      aria-label="Drawing surface"
      aria-disabled={disabled}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    />
  );
}

export default forwardRef(DrawingCanvas);
