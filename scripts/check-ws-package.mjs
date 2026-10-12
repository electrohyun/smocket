import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtures = join(repositoryRoot, 'scripts/fixtures/ws-package');
const repositoryRequire = createRequire(import.meta.url);
const compilers = [
  { version: '5.0.2', nodeTypes: '20.0.0' },
  { version: '6.0.3', nodeTypes: '26.1.1' },
];

function options() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--fixture') return { fixture: true };
  if (args.length === 2 && args[0] === '--tarball' && !args[1].startsWith('--')) {
    return { tarball: resolve(args[1]) };
  }
  throw new Error('Use --tarball <path> for a package, or --fixture to check the test harness.');
}

const selected = options();
const temporaryRoot = await mkdtemp(join(tmpdir(), 'smocket-ws-package-'));

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const windowsNpm = process.platform === 'win32' && command === 'npm';
    const child = spawn(
      windowsNpm ? (process.env.ComSpec ?? 'cmd.exe') : command,
      windowsNpm ? ['/d', '/s', '/c', command, ...args] : args,
      {
        cwd,
        env: {
          ...process.env,
          npm_config_cache: join(temporaryRoot, 'npm-cache'),
          npm_config_update_notifier: 'false',
          // Prevent inherited host configuration from installing production deps only.
          npm_config_omit: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolveRun(stdout);
      else reject(new Error(`${command} failed (${signal ?? code}):\n${stdout}${stderr}`));
    });
  });
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function install(cwd) {
  await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], cwd);
}

async function fixtureTarball() {
  const packageRoot = join(temporaryRoot, 'fixture');
  const source = join(packageRoot, 'src');
  await mkdir(source, { recursive: true });
  for (const file of ['entry.ts', 'runtime.js', 'runtime.d.ts']) {
    await copyFile(join(fixtures, 'package', file), join(source, file));
  }
  await copyFile(join(repositoryRoot, 'src/ws/contracts.ts'), join(source, 'contracts.cts'));
  await writeJson(join(packageRoot, 'package.json'), {
    name: 'smocket',
    version: '0.0.0-ws-package-fixture',
    private: true,
    type: 'module',
    files: ['dist'],
    exports: {
      './ws': {
        import: { types: './dist/ws.d.ts', default: './dist/ws.js' },
        require: { types: './dist/ws.d.cts', default: './dist/ws.cjs' },
      },
    },
    devDependencies: { typescript: compilers[1].version },
  });
  await writeJson(join(packageRoot, 'tsconfig.json'), {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      // tsup's declaration bundler supplies baseUrl internally under TS 6.
      ignoreDeprecations: '6.0',
      strict: true,
      types: [],
      lib: ['ES2022', 'DOM'],
    },
  });
  console.log('Building a test-only package with fixture constructors.');
  await install(packageRoot);
  await run(
    process.execPath,
    [join(fixtures, 'package/build.mjs'), repositoryRequire.resolve('tsup')],
    packageRoot,
  );
  const packed = JSON.parse(
    await run(
      'npm',
      ['pack', '.', '--json', '--ignore-scripts', '--pack-destination', temporaryRoot],
      packageRoot,
    ),
  );
  assert.equal(packed.length, 1, 'The fixture must produce exactly one tarball');
  return join(temporaryRoot, basename(packed[0].filename));
}

async function copyExamples(project, withNode) {
  for (const extension of ['ts', 'mts']) {
    await copyFile(join(fixtures, 'usage.ts'), join(project, `usage.${extension}`));
  }
  await copyFile(join(fixtures, 'commonjs.cts'), join(project, 'commonjs.cts'));
  await copyFile(join(fixtures, 'runtime.mjs'), join(project, 'runtime.mjs'));
  if (withNode) {
    for (const extension of ['mts', 'cts']) {
      await copyFile(join(fixtures, 'node-buffer.ts'), join(project, `buffer.${extension}`));
    }
    await copyFile(join(fixtures, 'require.cjs'), join(project, 'require.cjs'));
  }
}

async function checkConsumer(tarball, compiler, withNode) {
  const label = `TS ${compiler.version}, ${withNode ? 'with' : 'without'} Node types`;
  const project = join(
    temporaryRoot,
    `consumer-${compiler.version}-${withNode ? 'node' : 'no-node'}`,
  );
  await mkdir(project);
  await writeJson(join(project, 'package.json'), {
    name: 'ws-package-consumer',
    private: true,
    type: 'module',
    dependencies: { smocket: `file:${tarball}` },
    devDependencies: {
      typescript: compiler.version,
      ...(withNode ? { '@types/node': compiler.nodeTypes } : {}),
    },
  });
  console.log(`Installing consumer: ${label}.`);
  await install(project);

  const manifest = JSON.parse(
    await readFile(join(project, 'node_modules/smocket/package.json'), 'utf8'),
  );
  assert.equal(manifest.name, 'smocket');
  assert.ok(manifest.exports?.['./ws'], 'The packed package must export smocket/ws');
  // Verify physical isolation as well as compiler types=[], including transitives.
  const forbidden = withNode
    ? ['ws', 'socket.io', 'socket.io-client']
    : ['ws', 'socket.io', 'socket.io-client', '@types/node'];
  for (const name of forbidden) {
    const matches = JSON.parse(await run('npm', ['query', `[name="${name}"]`], project));
    assert.equal(matches.length, 0, `${label}: unexpected installed dependency ${name}`);
  }
  await copyExamples(project, withNode);

  for (const mode of ['NodeNext', 'Bundler']) {
    const configName = `tsconfig.${mode.toLowerCase()}.json`;
    await writeJson(join(project, configName), {
      compilerOptions: {
        target: 'ES2022',
        module: mode === 'NodeNext' ? 'NodeNext' : 'ESNext',
        moduleResolution: mode,
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        noUnusedLocals: true,
        noUncheckedIndexedAccess: true,
        lib: ['ES2022', 'DOM'],
        types: withNode ? ['node'] : [],
        ...(withNode && mode === 'NodeNext' ? { allowJs: true, checkJs: true } : {}),
      },
      include:
        mode === 'NodeNext'
          ? ['*.mts', '*.cts', ...(withNode ? ['require.cjs'] : [])]
          : ['*.ts', '*.mts'],
    });
    await run(
      process.execPath,
      [join(project, 'node_modules/typescript/bin/tsc'), '-p', configName],
      project,
    );
    console.log(`${label}, ${mode}: passed.`);
  }
  await run(process.execPath, [join(project, 'runtime.mjs')], project);
  console.log(`${label}, ESM/CJS loading and constructor exports: passed.`);
}

try {
  const tarball = selected.fixture ? await fixtureTarball() : selected.tarball;
  await access(tarball);
  // Every consumer installs the same artifact; never rebuild between scenarios.
  for (const compiler of compilers) {
    for (const withNode of [false, true]) {
      await checkConsumer(tarball, compiler, withNode);
    }
  }
  console.log(
    selected.fixture
      ? 'Fixture package checks passed. This does not validate the production ws runtime or entry point.'
      : 'Packed ws entry checks passed. Connections and delivery require the runtime conformance suite.',
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
