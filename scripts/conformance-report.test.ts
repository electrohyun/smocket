import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { runProject } from './conformance-report.mjs';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

const { spawnSync: spawnCommand } =
  await vi.importActual<typeof import('node:child_process')>('node:child_process');
const root = fileURLToPath(new URL('..', import.meta.url));
const reportPath = join(root, 'docs', 'conformance.md');
const passedReport = { success: true, testResults: [] };
const successfulRun = {
  pid: 1,
  output: [],
  stdout: Buffer.alloc(0),
  stderr: Buffer.alloc(0),
  status: 0,
  signal: null,
};
let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'smocket-conformance-test-'));
  vi.mocked(spawnSync).mockReturnValue(successfulRun);
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(outDir, { recursive: true, force: true });
});

it('reads a report only from a successful test process', () => {
  writeFileSync(join(outDir, 'mock.json'), JSON.stringify(passedReport));
  expect(runProject('mock', outDir)).toEqual(passedReport);
});

it('rejects a failed mock process even when its JSON report says cases passed', () => {
  writeFileSync(join(outDir, 'mock.json'), JSON.stringify(passedReport));
  vi.mocked(spawnSync).mockReturnValue({ ...successfulRun, status: 23 });

  expect(() => runProject('mock', outDir)).toThrow('mock test process exited with status 23');
});

it('rejects a signalled real process even when its JSON report says cases passed', () => {
  writeFileSync(join(outDir, 'real.json'), JSON.stringify(passedReport));
  vi.mocked(spawnSync).mockReturnValue({
    ...successfulRun,
    status: null,
    signal: 'SIGTERM',
  });

  expect(() => runProject('real', outDir)).toThrow('real test process terminated by SIGTERM');
});

it('rejects aggregate failure even when individual cases passed and the process exits zero', () => {
  const report = {
    success: false,
    testResults: [{ assertionResults: [{ status: 'passed' }] }],
  };
  writeFileSync(join(outDir, 'mock.json'), JSON.stringify(report));

  expect(() => runProject('mock', outDir)).toThrow('mock test report did not report success');
});

it('preserves spawn errors before trying to read a report', () => {
  const error = Object.assign(new Error('could not start test process'), { code: 'ENOENT' });
  vi.mocked(spawnSync).mockReturnValue({ ...successfulRun, status: null, error });

  expect(() => runProject('real', outDir)).toThrow(error);
});

it.each(['write', 'check'] as const)(
  'fails the %s command without changing the report after a test process fails',
  (mode) => {
    const existing = readFileSync(reportPath, 'utf8');
    const preload = join(outDir, 'failed-process.mjs');
    const outputDirectory = join(outDir, 'output-directory.txt');
    writeFileSync(
      preload,
      `import childProcess from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname } from 'node:path';
childProcess.spawnSync = (_command, args) => {
  const output = args.find((arg) => arg.startsWith('--outputFile='));
  if (!output) throw new Error('test process must request a JSON report');
  writeFileSync(${JSON.stringify(outputDirectory)}, dirname(output.slice('--outputFile='.length)));
  writeFileSync(output.slice('--outputFile='.length), JSON.stringify({ success: true, testResults: [] }));
  return { status: 23, signal: null };
};
syncBuiltinESMExports();
`,
    );

    const result = spawnCommand(
      process.execPath,
      [
        '--import',
        pathToFileURL(preload).href,
        join(root, 'scripts', 'conformance-report.mjs'),
        ...(mode === 'check' ? ['--check'] : []),
      ],
      { cwd: root, encoding: 'utf8' },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('real test process exited with status 23');
    expect(readFileSync(reportPath, 'utf8')).toBe(existing);
    expect(existsSync(readFileSync(outputDirectory, 'utf8'))).toBe(false);
  },
);
