export interface Socket {
  label: string;
  emit(event: 'data', value: string | number): boolean;
  transform(value: string): string;
  optionalTrace?: string;
}

export type AddedExport = { enabled: boolean };
