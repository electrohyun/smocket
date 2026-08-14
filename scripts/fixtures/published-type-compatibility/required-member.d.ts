export interface Socket {
  label: string;
  emit(event: 'data' | 'trace', value: string | number): boolean;
  transform(value: string): string | number;
  trace(): void;
}
