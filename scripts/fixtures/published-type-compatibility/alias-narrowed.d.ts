type Payload = string;

interface Socket {
  emit(event: 'data', value: Payload): boolean;
}

export { type Socket };
