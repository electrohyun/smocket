export interface Socket {
  readonly label: string;
  emit(event: 'data', value: string | number): boolean;
  transform(value: string): string;
}
