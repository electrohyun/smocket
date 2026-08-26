import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const typescriptVersion = '6.0.3';

function run(command, args, cwd, capture = false) {
  return new Promise((resolveRun, reject) => {
    const useWindowsCommandShell = process.platform === 'win32' && command === 'npm';
    const executable = useWindowsCommandShell ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const executableArgs = useWindowsCommandShell ? ['/d', '/s', '/c', command, ...args] : args;
    const child = spawn(executable, executableArgs, {
      cwd,
      env: {
        ...process.env,
        npm_config_cache: join(temporaryRoot, 'npm-cache'),
        npm_config_update_notifier: 'false',
      },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });

    let stdout = '';
    let stderr = '';
    if (capture) {
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
    }
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else
        reject(
          new Error(
            signal
              ? `${command} ended with ${signal}`
              : `${command} exited with ${code}${stderr ? `:\n${stderr}` : ''}`,
          ),
        );
    });
  });
}

function tarballOption() {
  const index = process.argv.indexOf('--tarball');
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error('--tarball requires a path');
  return resolve(value);
}

async function packRoot(destination) {
  const { stdout } = await run(
    'npm',
    ['pack', '.', '--json', '--ignore-scripts', '--pack-destination', destination],
    repositoryRoot,
    true,
  );
  const result = JSON.parse(stdout);
  if (!Array.isArray(result) || result.length !== 1 || typeof result[0]?.filename !== 'string') {
    throw new Error('npm pack must produce exactly one tarball');
  }
  return join(destination, basename(result[0].filename));
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'smocket-self-contained-types-'));
const projectRoot = join(temporaryRoot, 'consumer');

try {
  const suppliedTarball = tarballOption();
  if (suppliedTarball !== undefined) {
    assert.equal(isAbsolute(suppliedTarball), true);
    await access(suppliedTarball);
  }
  const archivePath = suppliedTarball ?? (await packRoot(temporaryRoot));
  const manifest = {
    name: 'smocket-self-contained-types',
    private: true,
    type: 'module',
    dependencies: { smocket: `file:${archivePath}` },
    devDependencies: { typescript: typescriptVersion },
  };
  const compilerOptions = {
    target: 'ES2022',
    strict: true,
    skipLibCheck: false,
    noEmit: true,
    types: [],
    lib: ['ES2022', 'WebWorker'],
  };
  const source = [
    "import type { ConnectOptions, ServerContract } from 'smocket';",
    "import type { SharedWorkerHost, SharedWorkerSocket } from 'smocket/shared-worker';",
    'declare const values: [ConnectOptions, ServerContract, SharedWorkerHost, SharedWorkerSocket];',
    'void values;',
    '',
  ].join('\n');

  await mkdir(projectRoot, { recursive: true });
  await writeFile(join(projectRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(projectRoot, 'index.mts'), source);
  await writeFile(join(projectRoot, 'index.cts'), source);
  await writeFile(join(projectRoot, 'index.ts'), source);
  await writeFile(
    join(projectRoot, 'tsconfig.nodenext.json'),
    `${JSON.stringify({ compilerOptions: { ...compilerOptions, module: 'NodeNext', moduleResolution: 'NodeNext' }, include: ['index.mts', 'index.cts'] }, null, 2)}\n`,
  );
  await writeFile(
    join(projectRoot, 'tsconfig.bundler.json'),
    `${JSON.stringify({ compilerOptions: { ...compilerOptions, module: 'ESNext', moduleResolution: 'Bundler' }, include: ['index.ts'] }, null, 2)}\n`,
  );

  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], projectRoot);
  await Promise.all([
    access(join(projectRoot, 'node_modules', 'socket.io')).then(
      () => assert.fail('socket.io must not be installed'),
      () => undefined,
    ),
    access(join(projectRoot, 'node_modules', 'socket.io-client')).then(
      () => assert.fail('socket.io-client must not be installed'),
      () => undefined,
    ),
  ]);
  const tsc = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  await run(process.execPath, [tsc, '-p', 'tsconfig.nodenext.json'], projectRoot);
  await run(process.execPath, [tsc, '-p', 'tsconfig.bundler.json'], projectRoot);

  const installed = JSON.parse(
    await readFile(join(projectRoot, 'node_modules', 'smocket', 'package.json'), 'utf8'),
  );
  console.log(
    `Self-contained TypeScript consumers passed for smocket@${installed.version} under NodeNext and Bundler without Socket.IO packages.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
