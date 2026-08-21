import assert from 'node:assert/strict';

interface RealModule {
  observeRealTarget(): Promise<unknown>;
}

interface SmocketModule {
  observeSmocketTarget(): Promise<unknown>;
}

const realUrl = new URL('./real/real.js', import.meta.url).href;
const smocketUrl = new URL('./smocket/smocket.js', import.meta.url).href;
const [real, smocket] = (await Promise.all([import(realUrl), import(smocketUrl)])) as [
  RealModule,
  SmocketModule,
];

const socketIoObservation = await real.observeRealTarget();
const smocketObservation = await smocket.observeSmocketTarget();
assert.deepEqual(smocketObservation, socketIoObservation);

console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      targets: {
        'socket.io@4.8.3': socketIoObservation,
        'smocket@workspace': smocketObservation,
      },
      deeplyEqual: true,
    },
    null,
    2,
  ),
);
