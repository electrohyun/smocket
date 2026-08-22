import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = join(repositoryRoot, 'consumers', 'test-adoption');
const exampleRoot = join(repositoryRoot, 'examples', 'chat-room');
const fixtureToolVersions = {
  '@vitest/browser': '4.1.10',
  '@vitest/browser-playwright': '4.1.10',
  jest: '30.2.0',
  playwright: '1.62.1',
  'socket.io-client': '4.8.3',
  typescript: '6.0.3',
  vitest: '4.1.10',
};
const applicationFiles = ['app.js', 'assertions.js', 'scenario.js'];
const [mode, ...arguments_] = process.argv.slice(2);
const options = new Map();

for (let index = 0; index < arguments_.length; index += 2) {
  const flag = arguments_[index];
  const value = arguments_[index + 1];

  if (flag === '--browser') {
    options.set(flag, true);
    index -= 1;
    continue;
  }

  if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) {
    throw new Error(
      'Usage: node scripts/run-clean-adoption.mjs <candidate|published> --version <exact-version> [--tarball <absolute-path>] [--client-tarball <absolute-path>] [--client-version <exact-version>] [--browser]',
    );
  }

  options.set(flag, value);
}

if (!new Set(['candidate', 'published']).has(mode)) {
  throw new Error('The first argument must be candidate or published');
}

const version = options.get('--version');
const archivePath = options.get('--tarball');
const clientArchivePath = options.get('--client-tarball');
const clientVersion = options.get('--client-version');
const packageInput =
  mode === 'candidate'
    ? `file:${archivePath ?? '<missing tarball>'}`
    : (version ?? '<missing version>');
const clientPackageInput =
  mode === 'candidate'
    ? clientArchivePath === undefined
      ? undefined
      : `file:${clientArchivePath}`
    : clientVersion;
const clientSubstitutionTarget = clientPackageInput === undefined ? 'smocket' : 'smocket-client';

await withContext(
  {
    runner: 'Node.js',
    moduleMode: 'package input validation',
    packageInput,
    fixture: 'clean adoption invocation',
  },
  async () => {
    assert.match(
      version ?? '',
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      'the package version must be exact',
    );

    if (mode === 'candidate') {
      assert.equal(
        clientVersion,
        undefined,
        'candidate mode accepts --client-tarball instead of --client-version',
      );
      assert.equal(typeof archivePath, 'string', 'candidate mode requires --tarball');
      assert.equal(isAbsolute(archivePath), true, 'candidate --tarball must be an absolute path');
      await access(archivePath);
      if (clientArchivePath !== undefined) {
        assert.equal(
          isAbsolute(clientArchivePath),
          true,
          'candidate --client-tarball must be an absolute path',
        );
        await access(clientArchivePath);
      }
    } else {
      assert.equal(
        archivePath,
        undefined,
        'published mode installs from the exact registry version',
      );
      assert.equal(
        clientArchivePath,
        undefined,
        'published mode accepts --client-version instead of --client-tarball',
      );
      if (clientVersion !== undefined) {
        assert.equal(
          clientVersion,
          version,
          'published smocket-client version must equal the root version',
        );
      }
    }
  },
);

function isInside(parent, child) {
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent === '' || (!pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..')
  );
}

function formatContext({ runner, moduleMode, packageInput, fixture }) {
  return [
    'clean adoption failure',
    `runner=${runner}`,
    `module mode=${moduleMode}`,
    `package input=${packageInput}`,
    `fixture=${fixture}`,
  ].join('; ');
}

function contextualError(context, message, cause) {
  return new Error(
    `${formatContext(context)}\n${message}`,
    cause === undefined ? undefined : { cause },
  );
}

async function withContext(context, operation) {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw contextualError(context, message, error);
  }
}

function run(command, args, cwd, context) {
  return new Promise((resolveRun, reject) => {
    const useWindowsCommandShell = process.platform === 'win32' && command === 'npm';
    const executable = useWindowsCommandShell ? (process.env.ComSpec ?? 'cmd.exe') : command;
    const executableArgs = useWindowsCommandShell ? ['/d', '/s', '/c', command, ...args] : args;
    const child = spawn(executable, executableArgs, {
      cwd,
      env: {
        ...process.env,
        SMOCKET_CLIENT_TARGET: clientSubstitutionTarget,
        npm_config_update_notifier: 'false',
      },
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      reject(contextualError(context, `could not start ${executable}: ${error.message}`, error));
    });
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      reject(contextualError(context, signal ? `terminated by ${signal}` : `exited with ${code}`));
    });
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function assembleProject(projectRoot, packageInput) {
  await cp(fixtureRoot, projectRoot, { recursive: true });
  await Promise.all(
    applicationFiles.map((file) => cp(join(exampleRoot, file), join(projectRoot, 'shared', file))),
  );

  const dependencies = { smocket: packageInput };
  if (clientPackageInput !== undefined) dependencies['smocket-client'] = clientPackageInput;

  const manifest = {
    name: 'smocket-clean-adoption',
    private: true,
    type: 'module',
    engines: { node: '>=20' },
    dependencies,
    devDependencies: fixtureToolVersions,
  };

  await writeFile(join(projectRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return packageInput;
}

async function assertInstalledIdentity(projectRoot, packageInput) {
  return withContext(
    {
      runner: 'Node createRequire',
      moduleMode: 'CommonJS resolution',
      packageInput,
      fixture: 'installed package identity',
    },
    async () => {
      const packagePath = join(projectRoot, 'node_modules', 'smocket', 'package.json');
      const installed = await readJson(packagePath);
      const resolvedPath = createRequire(join(projectRoot, 'package.json')).resolve('smocket');

      assert.equal(
        installed.version,
        version,
        'installed smocket version differs from the requested version',
      );
      assert.equal(
        isInside(repositoryRoot, resolvedPath),
        false,
        'smocket must resolve from the clean consumer, not the checkout',
      );
      console.log(`clean adoption package input: ${packageInput}`);
      console.log(`clean adoption source version: ${version}`);
      console.log(`clean adoption installed version: ${installed.version}`);
      console.log(`clean adoption resolved identity: ${resolvedPath}`);
      console.log(`clean adoption client substitution target: ${clientSubstitutionTarget}`);

      if (clientPackageInput !== undefined) {
        const clientPackagePath = join(
          projectRoot,
          'node_modules',
          'smocket-client',
          'package.json',
        );
        const installedClient = await readJson(clientPackagePath);
        const resolvedClientPath = createRequire(join(projectRoot, 'package.json')).resolve(
          'smocket-client',
        );
        assert.equal(
          installedClient.version,
          version,
          'installed smocket-client version differs from the root version',
        );
        assert.equal(
          installedClient.peerDependencies?.smocket,
          version,
          'installed smocket-client peer must be the exact root version',
        );
        assert.equal(
          isInside(repositoryRoot, resolvedClientPath),
          false,
          'smocket-client must resolve from the clean consumer, not the checkout',
        );
        console.log(`clean adoption client input: ${clientPackageInput}`);
        console.log(`clean adoption client resolved identity: ${resolvedClientPath}`);
      }
    },
  );
}

function fixtureContext(runner, moduleMode, packageInput, fixture) {
  return { runner, moduleMode, packageInput, fixture };
}

async function runNodeFixtures(projectRoot, packageInput) {
  const vitest = join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const jest = join(projectRoot, 'node_modules', 'jest', 'bin', 'jest.js');
  const tsc = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');

  await run(
    process.execPath,
    [vitest, 'run', '--config', 'vitest-suite/vitest.config.js'],
    projectRoot,
    fixtureContext('Vitest', 'ESM suite alias', packageInput, 'vitest-suite'),
  );
  await run(
    process.execPath,
    [vitest, 'run', '--config', 'vitest-file/vitest.config.js'],
    projectRoot,
    fixtureContext('Vitest', 'ESM hoisted per-file mock', packageInput, 'vitest-file'),
  );
  await run(
    process.execPath,
    [jest, '--config', 'jest/jest.config.cjs', '--runInBand'],
    projectRoot,
    fixtureContext('Jest', 'CommonJS moduleNameMapper', packageInput, 'jest'),
  );
  await run(
    process.execPath,
    [tsc, '-p', 'types/esm'],
    projectRoot,
    fixtureContext('TypeScript', 'Node16 ESM', packageInput, 'types/esm'),
  );
  await run(
    process.execPath,
    ['types/esm/dist/valid.js'],
    projectRoot,
    fixtureContext('Node.js', 'Node16 ESM emitted runtime', packageInput, 'types/esm'),
  );
  await run(
    process.execPath,
    [tsc, '-p', 'types/cjs'],
    projectRoot,
    fixtureContext('TypeScript', 'Node16 CommonJS', packageInput, 'types/cjs'),
  );
  await run(
    process.execPath,
    ['types/cjs/dist/valid.cjs'],
    projectRoot,
    fixtureContext('Node.js', 'Node16 CommonJS emitted runtime', packageInput, 'types/cjs'),
  );
  await run(
    process.execPath,
    [tsc, '-p', 'types/invalid'],
    projectRoot,
    fixtureContext('TypeScript', 'Node16 ESM negative contract', packageInput, 'types/invalid'),
  );
  await run(
    process.execPath,
    [tsc, '-p', 'types/server-socket/tsconfig.node16.json'],
    projectRoot,
    fixtureContext('TypeScript', 'Node16 Socket type', packageInput, 'types/server-socket'),
  );
  await run(
    process.execPath,
    [tsc, '-p', 'types/server-socket/tsconfig.bundler.json'],
    projectRoot,
    fixtureContext('TypeScript', 'bundler Socket type', packageInput, 'types/server-socket'),
  );
  await run(
    process.execPath,
    [
      vitest,
      'run',
      'static-namespace/adoption.test.js',
      '--config',
      'static-namespace/vitest.config.js',
    ],
    projectRoot,
    fixtureContext('Vitest', 'ESM suite alias', packageInput, 'static-namespace'),
  );
}

async function runClientPackageFixtures(projectRoot) {
  const tsc = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');

  await run(
    process.execPath,
    ['client-package/runtime.mjs'],
    projectRoot,
    fixtureContext(
      'Node.js',
      'ESM package import',
      clientPackageInput,
      'client-package/runtime.mjs',
    ),
  );
  await run(
    process.execPath,
    ['client-package/runtime.cjs'],
    projectRoot,
    fixtureContext(
      'Node.js',
      'callable CommonJS package root',
      clientPackageInput,
      'client-package/runtime.cjs',
    ),
  );
  await run(
    process.execPath,
    [tsc, '-p', 'client-package/tsconfig.node16.json'],
    projectRoot,
    fixtureContext(
      'TypeScript',
      'Node16 ESM and CommonJS',
      clientPackageInput,
      'client-package types',
    ),
  );
  await run(
    process.execPath,
    [tsc, '-p', 'client-package/tsconfig.bundler.json'],
    projectRoot,
    fixtureContext('TypeScript', 'bundler ESM', clientPackageInput, 'client-package types'),
  );
}

async function runSharedWorkerPackageFixtures(projectRoot) {
  const tsc = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');

  await run(
    process.execPath,
    ['client-package/shared-worker-runtime.mjs'],
    projectRoot,
    fixtureContext(
      'Node.js',
      'ESM SharedWorker subpath import',
      clientPackageInput,
      'client-package/shared-worker-runtime.mjs',
    ),
  );
  await run(
    process.execPath,
    ['client-package/shared-worker-runtime.cjs'],
    projectRoot,
    fixtureContext(
      'Node.js',
      'CommonJS SharedWorker subpath import',
      clientPackageInput,
      'client-package/shared-worker-runtime.cjs',
    ),
  );
  await run(
    process.execPath,
    [tsc, '-p', 'client-package/tsconfig.shared-worker.node16.json'],
    projectRoot,
    fixtureContext(
      'TypeScript',
      'Node16 SharedWorker subpath types',
      clientPackageInput,
      'client-package SharedWorker types',
    ),
  );
  await run(
    process.execPath,
    [tsc, '-p', 'client-package/tsconfig.shared-worker.bundler.json'],
    projectRoot,
    fixtureContext(
      'TypeScript',
      'bundler SharedWorker subpath types',
      clientPackageInput,
      'client-package SharedWorker types',
    ),
  );
}

async function runPublishedFixtures(projectRoot, packageInput) {
  const vitest = join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const jest = join(projectRoot, 'node_modules', 'jest', 'bin', 'jest.js');
  const tsc = join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');

  await run(
    process.execPath,
    [vitest, 'run', '--config', 'vitest-suite/vitest.config.js'],
    projectRoot,
    fixtureContext('Vitest', 'ESM suite alias', packageInput, 'published vitest-suite'),
  );
  await run(
    process.execPath,
    [jest, '--config', 'jest/jest.config.cjs', '--runInBand'],
    projectRoot,
    fixtureContext('Jest', 'CommonJS moduleNameMapper', packageInput, 'published jest'),
  );
  await run(
    process.execPath,
    [tsc, '-p', 'types/esm'],
    projectRoot,
    fixtureContext('TypeScript', 'Node16 ESM', packageInput, 'published types/esm'),
  );
  await run(
    process.execPath,
    [tsc, '-p', 'types/cjs'],
    projectRoot,
    fixtureContext('TypeScript', 'Node16 CommonJS', packageInput, 'published types/cjs'),
  );
  await run(
    process.execPath,
    ['types/cjs/dist/valid.cjs'],
    projectRoot,
    fixtureContext(
      'Node.js',
      'Node16 CommonJS emitted runtime',
      packageInput,
      'published types/cjs',
    ),
  );
  await run(
    process.execPath,
    [tsc, '-p', 'types/invalid'],
    projectRoot,
    fixtureContext(
      'TypeScript',
      'Node16 ESM negative contract',
      packageInput,
      'published types/invalid',
    ),
  );
}

async function runBrowserFixture(projectRoot, packageInput) {
  const vitest = join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');
  await run(
    process.execPath,
    [vitest, 'run', 'browser/adoption.test.js', '--config', 'browser/vitest.config.js'],
    projectRoot,
    fixtureContext('Vitest Playwright', 'Chromium browser ESM', packageInput, 'browser'),
  );
  if (clientPackageInput !== undefined) {
    await run(
      process.execPath,
      [
        vitest,
        'run',
        'client-package/browser.test.js',
        '--config',
        'client-package/vitest.config.js',
      ],
      projectRoot,
      fixtureContext(
        'Vitest Playwright',
        'Chromium browser ESM',
        clientPackageInput,
        'client-package/browser.test.js',
      ),
    );
  }
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'smocket-clean-adoption-'));
const projectRoot = join(temporaryRoot, 'project');
process.env.npm_config_cache = join(temporaryRoot, 'npm-cache');

try {
  await withContext(
    fixtureContext('Node.js', 'filesystem assembly', packageInput, 'clean adoption project'),
    async () => {
      assert.equal(
        isInside(repositoryRoot, temporaryRoot),
        false,
        'the clean adoption project must run outside the repository checkout',
      );
      await assembleProject(projectRoot, packageInput);
    },
  );
  await run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
    projectRoot,
    fixtureContext('npm', 'package installation', packageInput, 'clean adoption project'),
  );
  await assertInstalledIdentity(projectRoot, packageInput);

  if (mode === 'candidate') {
    await runNodeFixtures(projectRoot, packageInput);
    if (clientPackageInput !== undefined) {
      await runClientPackageFixtures(projectRoot);
      await runSharedWorkerPackageFixtures(projectRoot);
    }
    if (options.get('--browser') === true) await runBrowserFixture(projectRoot, packageInput);
  } else {
    await runPublishedFixtures(projectRoot, packageInput);
    if (clientPackageInput !== undefined) await runClientPackageFixtures(projectRoot);
  }

  console.log(`${mode} clean adoption fixtures passed`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
