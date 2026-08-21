import assert from 'node:assert/strict';
import type { ScenarioObservation } from './scenario.js';

export const expectedObservation: ScenarioObservation = {
  connections: [
    { label: 'A', socketId: 'sid_A' },
    { label: 'B', socketId: 'sid_B' },
    { label: 'C', socketId: 'sid_C' },
  ],
  distinctSocketIds: true,
  joins: [
    { label: 'A', acknowledgement: { accepted: true, room: 'room-1' } },
    { label: 'B', acknowledgement: { accepted: true, room: 'room-1' } },
    { label: 'C', acknowledgement: { accepted: true, room: 'room-1' } },
  ],
  events: {
    A: [
      { event: 'chat', payload: { from: 'B', text: 'zebra' } },
      { event: 'announce', payload: { winner: 'C', word: 'giraffe' } },
    ],
    B: [
      {
        event: 'stroke',
        payload: {
          id: 1,
          points: [
            [0.1, 0.2],
            [0.3, 0.4],
          ],
        },
      },
      { event: 'chat', payload: { from: 'B', text: 'zebra' } },
      { event: 'announce', payload: { winner: 'C', word: 'giraffe' } },
      {
        event: 'stroke',
        payload: { id: 2, points: [[0.5, 0.6]], end: true },
      },
    ],
    C: [
      {
        event: 'stroke',
        payload: {
          id: 1,
          points: [
            [0.1, 0.2],
            [0.3, 0.4],
          ],
        },
      },
      { event: 'chat', payload: { from: 'B', text: 'zebra' } },
      { event: 'correct', payload: { word: 'giraffe' } },
      { event: 'announce', payload: { winner: 'C', word: 'giraffe' } },
    ],
  },
  acknowledgements: [
    { from: 'B', value: false },
    { from: 'C', value: true },
  ],
  deliveries: [
    {
      event: 'stroke',
      payload: {
        id: 1,
        points: [
          [0.1, 0.2],
          [0.3, 0.4],
        ],
      },
      recipients: ['B', 'C'],
      senderExcluded: 'A',
    },
    {
      event: 'chat',
      payload: { from: 'B', text: 'zebra' },
      recipients: ['A', 'B', 'C'],
    },
    {
      event: 'correct',
      payload: { word: 'giraffe' },
      recipients: ['C'],
    },
    {
      event: 'announce',
      payload: { winner: 'C', word: 'giraffe' },
      recipients: ['A', 'B', 'C'],
    },
    {
      event: 'stroke',
      payload: { id: 2, points: [[0.5, 0.6]], end: true },
      recipients: ['B'],
      senderExcluded: 'A',
      disconnected: ['C'],
    },
  ],
  disconnect: {
    label: 'C',
    serverObserved: true,
    connectedAfter: false,
    remaining: ['A', 'B'],
  },
};

export function assertScenarioObservation(observation: ScenarioObservation): ScenarioObservation {
  assert.deepEqual(observation, expectedObservation);
  return observation;
}
