import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const currentTypescriptVersion = '6.0.3';
const minimumTypescriptVersion = '5.0.2';

function typescriptVersionOption() {
  const usesMinimum = process.argv.includes('--minimum');
  const index = process.argv.indexOf('--typescript-version');
  if (usesMinimum && index !== -1) {
    throw new Error('--minimum and --typescript-version cannot be used together');
  }
  if (usesMinimum) return minimumTypescriptVersion;
  if (index === -1) return currentTypescriptVersion;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error('--typescript-version requires a version');
  }
  return value;
}

const typescriptVersion = typescriptVersionOption();

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

function pathOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a path`);
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
  const suppliedTarball = pathOption('--tarball');
  const suppliedClientTarball = pathOption('--client-tarball');
  if (suppliedTarball !== undefined) {
    assert.equal(isAbsolute(suppliedTarball), true);
    await access(suppliedTarball);
  }
  if (suppliedClientTarball !== undefined) {
    assert.equal(isAbsolute(suppliedClientTarball), true);
    await access(suppliedClientTarball);
  }
  const archivePath = suppliedTarball ?? (await packRoot(temporaryRoot));
  const dependencies = { smocket: `file:${archivePath}` };
  if (suppliedClientTarball !== undefined) {
    dependencies['smocket-client'] = `file:${suppliedClientTarball}`;
  }
  const manifest = {
    name: 'smocket-self-contained-types',
    private: true,
    type: 'module',
    dependencies,
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
    "import { connect, type ConnectOptions, type ServerContract } from 'smocket';",
    "import type { SharedWorkerHost, SharedWorkerSocket } from 'smocket/shared-worker';",
    'declare const values: [ConnectOptions, ServerContract, SharedWorkerHost, SharedWorkerSocket];',
    'void values;',
    '// @ts-expect-error Public connect derives its namespace from the URL pathname.',
    "connect('http://localhost:3012', { namespace: '/ignored' });",
    ...(suppliedClientTarball === undefined
      ? []
      : [
          "import { connect as clientConnect, type Socket as ClientSocket } from 'smocket-client';",
          "import { connectSharedWorker as connectClientSharedWorker } from 'smocket-client/shared-worker';",
          'declare const clientSocket: ClientSocket;',
          'void clientConnect;',
          'void connectClientSharedWorker;',
          'void clientSocket;',
        ]),
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
  const { stdout: dependencyQuery } = await run(
    'npm',
    ['query', '[name=socket.io], [name=socket.io-client]'],
    projectRoot,
    true,
  );
  const unexpectedDependencies = JSON.parse(dependencyQuery).map(({ name, version, location }) => ({
    name,
    version,
    location,
  }));
  assert.deepEqual(
    unexpectedDependencies,
    [],
    'socket.io and socket.io-client must not appear anywhere in the installed dependency tree',
  );
  const tsc = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  await run(process.execPath, [tsc, '-p', 'tsconfig.nodenext.json'], projectRoot);
  await run(process.execPath, [tsc, '-p', 'tsconfig.bundler.json'], projectRoot);

  const installed = JSON.parse(
    await readFile(join(projectRoot, 'node_modules', 'smocket', 'package.json'), 'utf8'),
  );
  console.log(
    `Self-contained TypeScript ${typescriptVersion} consumers passed for smocket@${installed.version}${suppliedClientTarball === undefined ? '' : ' and smocket-client'} under NodeNext and Bundler without Socket.IO packages.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
