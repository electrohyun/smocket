export interface Socket {
  label: string;
  emit(event: 'data', value: string): boolean;
  transform(value: string): string;
}
