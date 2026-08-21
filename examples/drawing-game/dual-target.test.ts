import assert from 'node:assert/strict';
import test from 'node:test';

interface RealModule {
  observeRealTarget(): Promise<unknown>;
}

interface SmocketModule {
  observeSmocketTarget(): Promise<unknown>;
}

async function loadTargets(): Promise<[RealModule, SmocketModule]> {
  const realUrl = new URL('./real/real.js', import.meta.url).href;
  const smocketUrl = new URL('./smocket/smocket.js', import.meta.url).href;
  return Promise.all([import(realUrl), import(smocketUrl)]);
}

test('Real Socket.IO and Smocket produce deeply equal drawing-game observations', async () => {
  const [real, smocket] = await loadTargets();
  const realObservation = await real.observeRealTarget();
  const smocketObservation = await smocket.observeSmocketTarget();

  assert.deepEqual(smocketObservation, realObservation);
});

test('a second run has no state left over from the first run', async () => {
  const [real, smocket] = await loadTargets();
  const firstReal = await real.observeRealTarget();
  const firstSmocket = await smocket.observeSmocketTarget();
  const secondReal = await real.observeRealTarget();
  const secondSmocket = await smocket.observeSmocketTarget();

  assert.deepEqual(secondReal, firstReal);
  assert.deepEqual(secondSmocket, firstSmocket);
  assert.deepEqual(secondSmocket, secondReal);
});
