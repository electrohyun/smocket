import scenario from './scenario.cjs';

const target = process.argv[2] ?? 'mock';
if (target !== 'mock' && target !== 'real') throw new Error('Use mock or real.');
const { default: WebSocket, WebSocketServer } = await import(
  target === 'real' ? 'ws' : 'smocket/ws'
);
const result = await scenario.runScenario({ WebSocket, WebSocketServer });

for (const [index, messages] of result.messages.entries()) {
  console.log(`${['A', 'B', 'C'][index]} received: ${JSON.stringify(messages)}`);
}
console.log(`Connected clients: ${result.membership.join(' -> ')}`);
