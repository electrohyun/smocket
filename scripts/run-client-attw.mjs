import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const clientRoot = join(repositoryRoot, 'packages', 'smocket-client');
const require = createRequire(import.meta.url);
const cli = join(
  dirname(require.resolve('@arethetypeswrong/cli/package.json')),
  'dist',
  'index.js',
);

function run(command, args, cwd, stdio = 'inherit') {
  return new Promise((resolve, reject) => {
    const useWindowsCommandShell = process.platform === 'win32' && command === 'npm';
    const executable = useWindowsCommandShell ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const executableArgs = useWindowsCommandShell ? ['/d', '/s', '/c', command, ...args] : args;
    const child = spawn(executable, executableArgs, {
      cwd,
      env: { ...process.env, npm_config_update_notifier: 'false' },
      stdio,
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(signal ? `${command} ended with ${signal}` : `${command} exited with ${code}`),
        );
    });
  });
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'smocket-client-attw-'));
process.env.npm_config_cache = join(temporaryRoot, 'npm-cache');

try {
  await run(
    'npm',
    ['pack', '.', '--ignore-scripts', '--pack-destination', temporaryRoot],
    clientRoot,
    'ignore',
  );
  const archives = (await readdir(temporaryRoot)).filter((file) => file.endsWith('.tgz'));
  if (archives.length !== 1) {
    throw new Error(`Expected one client tarball, found ${archives.length}`);
  }
  await run(process.execPath, [cli, join(temporaryRoot, archives[0])], repositoryRoot);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
