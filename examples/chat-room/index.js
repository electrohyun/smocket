import { runScenario } from './scenario.js';

const { transcript } = await runScenario();

console.log(transcript.join('\n'));
