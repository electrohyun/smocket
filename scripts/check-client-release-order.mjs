import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const rootManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
const clientManifest = JSON.parse(
  await readFile(join(repositoryRoot, 'packages', 'smocket-client', 'package.json'), 'utf8'),
);

if (clientManifest.version !== rootManifest.version) {
  throw new Error(
    `smocket-client ${clientManifest.version} cannot publish with smocket ${rootManifest.version}`,
  );
}

const expected = rootManifest.version;
const command = 'npm';
const args = ['view', `smocket@${expected}`, 'version', '--json'];
const useWindowsCommandShell = process.platform === 'win32';
const executable = useWindowsCommandShell ? (process.env.ComSpec ?? 'cmd.exe') : command;
const executableArgs = useWindowsCommandShell ? ['/d', '/s', '/c', command, ...args] : args;
const child = spawn(executable, executableArgs, {
  env: { ...process.env, npm_config_update_notifier: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

const code = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('close', resolve);
});

if (code !== 0) {
  throw new Error(
    `Publish smocket ${expected} before smocket-client ${expected}${stderr ? `:\n${stderr}` : ''}`,
  );
}

const published = JSON.parse(stdout);
if (published !== expected) {
  throw new Error(`Registry returned smocket ${JSON.stringify(published)}, expected ${expected}`);
}

console.log(`Release order passed: smocket ${expected} is already published.`);
