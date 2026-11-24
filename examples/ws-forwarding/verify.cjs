const RealWebSocket = require('ws');
const WebSocket = require('smocket/ws').default;
const { WebSocketServer } = require('smocket/ws');
const { runScenario } = require('./scenario.cjs');
const { assertObservation } = require('./assertions.cjs');

async function verify() {
  for (const includeSender of [false, true]) {
    const real = await runScenario(
      { WebSocket: RealWebSocket, WebSocketServer: RealWebSocket.WebSocketServer },
      { includeSender },
    );
    const mock = await runScenario({ WebSocket, WebSocketServer }, { includeSender });

    assertObservation(real, includeSender);
    assertObservation(mock, includeSender);
  }
  console.log('CommonJS forwarding application matches real ws.');
}

verify().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
