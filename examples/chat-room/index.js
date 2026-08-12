import { runScenario } from './bootstrap.js';

const { transcript } = await runScenario();

console.log(transcript.join('\n'));
