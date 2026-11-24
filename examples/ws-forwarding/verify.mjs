import RealWebSocket, { WebSocketServer as RealServer } from 'ws';
import WebSocket, { WebSocketServer } from 'smocket/ws';
import scenario from './scenario.cjs';
import assertions from './assertions.cjs';

for (const includeSender of [false, true]) {
  const real = await scenario.runScenario(
    { WebSocket: RealWebSocket, WebSocketServer: RealServer },
    { includeSender },
  );
  const mock = await scenario.runScenario({ WebSocket, WebSocketServer }, { includeSender });

  assertions.assertObservation(real, includeSender);
  assertions.assertObservation(mock, includeSender);
}

console.log('ESM forwarding application matches real ws.');
