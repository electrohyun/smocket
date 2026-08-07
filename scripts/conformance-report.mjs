// Generate the case list in `docs/conformance.md` from an actual dual run.
//
// The report's claim is that every behaviour it names was measured against a real
// socket.io server and then against the mock. A hand-written list cannot carry that
// claim for long: it drifts the moment a case is added, renamed, or deleted, and a
// reader has no way to tell a stale line from a current one. So the list is derived
// from the run itself, and the run has to be green before anything is written. A case
// appears here only because it passed on both targets, which is why the generated
// section has no result column: an unverified case is absent rather than marked.
//
// `--check` regenerates and compares instead of writing, which is what CI runs. Only
// the region between the markers is generated; the prose around it is written by hand
// and left alone.
//
// Usage:
//   pnpm conformance         write docs/conformance.md
//   pnpm check:conformance   fail if it is out of date

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';

const root = fileURLToPath(new URL('..', import.meta.url));
const reportPath = join(root, 'docs', 'conformance.md');

const START = '<!-- conformance:generated start -->';
const END = '<!-- conformance:generated end -->';

/**
 * Report order, and the one-line description each area carries. Ordered as a reader
 * meets the library rather than alphabetically: connect, join a room, broadcast, then
 * the narrower surface, with disconnect last.
 *
 * Which of the two groups an area lands in is not declared here. It is read off the
 * test file's own imports (see `hasOracle`), so an area cannot be filed under "verified
 * against socket.io" by editing this table. A `src/*.test.ts` file missing from here
 * fails the run rather than being quietly dropped from the report.
 */
const AREAS = [
  {
    file: 'src/connection.test.ts',
    title: 'Connection and identity',
    blurb: 'Pairing a client with its server socket, the id both sides see, and the first emit.',
  },
  {
    file: 'src/rooms.test.ts',
    title: 'Rooms',
    blurb: 'Join and leave, and which members an emit to a room reaches.',
  },
  {
    file: 'src/broadcast.test.ts',
    title: 'Broadcast',
    blurb: 'The broadcast variants and the sockets each one targets or excludes.',
  },
  {
    file: 'src/broadcast-chaining.test.ts',
    title: 'Broadcast chaining',
    blurb: 'Narrowing a broadcast further, and whether the order of the narrowings matters.',
  },
  {
    file: 'src/namespace.test.ts',
    title: 'Namespaces',
    blurb: 'What a namespace isolates: connections, emits, rooms, and socket ids.',
  },
  {
    file: 'src/ack.test.ts',
    title: 'Acknowledgements',
    blurb: 'The trailing callback and `emitWithAck`, in both directions.',
  },
  {
    file: 'src/timeout.test.ts',
    title: 'Acknowledgement timeouts',
    blurb: '`timeout(ms)` on a single emit, and what a late ack does.',
  },
  {
    file: 'src/broadcast-timeout.test.ts',
    title: 'Broadcast acknowledgements',
    blurb: 'Collecting an ack from every recipient of a broadcast, and answering on expiry.',
  },
  {
    file: 'src/middleware.test.ts',
    title: 'Connection middleware',
    blurb: '`io.use`: admitting a connection, rejecting one, and the order two run in.',
  },
  {
    file: 'src/handshake.test.ts',
    title: 'Handshake',
    blurb: 'The handshake fields a mock can source, and how auth and query reach them.',
  },
  {
    file: 'src/socket-data.test.ts',
    title: 'socket.data',
    blurb: 'The per-socket store, its isolation, and its lifetime.',
  },
  {
    file: 'src/volatile.test.ts',
    title: 'Volatile emits',
    blurb: 'What `volatile` delivers in steady state, and the one window where it drops.',
  },
  {
    file: 'src/on-any.test.ts',
    title: 'Catch-all listeners',
    blurb: '`onAny` / `offAny` on both sides, and the events they do not see.',
  },
  {
    file: 'src/on-any-outgoing.test.ts',
    title: 'Outgoing catch-all listeners',
    blurb: '`onAnyOutgoing` / `offAnyOutgoing`, and where in the send path they fire.',
  },
  {
    file: 'src/remove-listeners.test.ts',
    title: 'Listener removal',
    blurb: '`off` and `removeAllListeners`, including the places the two sides disagree.',
  },
  {
    file: 'src/disconnect.test.ts',
    title: 'Disconnect',
    blurb: 'Room cleanup, the reason each side reports, and what happens to a pending ack.',
  },

  {
    file: 'src/connect-url.test.ts',
    title: 'connect(url) and the origin registry',
    blurb: 'Resolving a url to a server, and what the url contributes to the handshake.',
  },
  {
    file: 'src/adapter.test.ts',
    title: 'Adapter API',
    blurb: 'Registering an adapter that changes the routing decision.',
  },
  {
    file: 'src/delay-adapter.test.ts',
    title: 'DelayingAdapter',
    blurb: "Holding a socket's client-inbound stream so a race can be interleaved on purpose.",
  },
  {
    file: 'src/socket-id.test.ts',
    title: 'Socket id encoding',
    blurb: 'The encoder behind the id shape the dual run pins.',
  },
  {
    file: 'src/index.test.ts',
    title: 'Public entry points',
    blurb: 'What the package exports, including the `io` name the substitution path needs.',
  },
];

/** Run one vitest project and return its JSON report. */
function runProject(project, outDir) {
  const outputFile = join(outDir, `${project}.json`);
  const result = spawnSync(
    process.execPath,
    [
      join('node_modules', 'vitest', 'vitest.mjs'),
      'run',
      `--project=${project}`,
      // Without this the reporter omits each case's line, and the report could
      // only link a file rather than the test that pins the behaviour.
      '--includeTaskLocation',
      '--reporter=json',
      `--outputFile=${outputFile}`,
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  return JSON.parse(readFileSync(outputFile, 'utf8'));
}

/** Absolute path from the reporter, as a repo-relative posix path. */
function relative(name) {
  return name.replaceAll('\\', '/').replace(root.replaceAll('\\', '/'), '');
}

/**
 * Index a report by file, then by case name. The two runs execute the same files, so
 * this is what lets a case be looked up on the other target.
 */
function index(report) {
  const files = new Map();
  for (const file of report.testResults) {
    const cases = new Map();
    for (const assertion of file.assertionResults) {
      cases.set(assertion.fullName, assertion);
    }
    files.set(relative(file.name), cases);
  }
  return files;
}

/** Whether the file compares against real socket.io, read off its own imports. */
function hasOracle(file) {
  return readFileSync(join(root, file), 'utf8').includes("from './setup-server'");
}

/**
 * Collect the cases of one area, insisting both targets ran the same ones. A case
 * present on one target only means the file branches on the target, which would make
 * every claim in this report conditional, so it stops the run.
 */
function collect(area, real, mock) {
  const realCases = real.get(area.file);
  const mockCases = mock.get(area.file);
  if (!realCases || !mockCases) {
    throw new Error(`${area.file} did not run on both targets. Was it renamed?`);
  }

  const names = new Set([...realCases.keys(), ...mockCases.keys()]);
  const cases = [];
  for (const name of names) {
    const onReal = realCases.get(name);
    const onMock = mockCases.get(name);
    if (!onReal || !onMock) {
      throw new Error(
        `"${name}" (${area.file}) ran on ${onReal ? 'the real target' : 'the mock target'} only. ` +
          'Every case has to run on both, or the report cannot say it was compared.',
      );
    }
    for (const [target, assertion] of [
      ['real socket.io', onReal],
      ['smocket', onMock],
    ]) {
      if (assertion.status !== 'passed') {
        throw new Error(
          `"${name}" (${area.file}) is ${assertion.status} on ${target}. ` +
            'The report is generated from a green dual run only: fix or remove the case first.',
        );
      }
    }
    cases.push({ name, line: onReal.location?.line ?? onMock.location?.line });
  }
  // Source order, so the report reads in the order the file does.
  cases.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  return cases;
}

/**
 * Wrap a paragraph the way the hand-written prose around it is wrapped. Prettier leaves
 * markdown prose alone (`proseWrap` defaults to preserve), so without this the generated
 * paragraphs would be single long lines beside wrapped ones.
 */
function wrap(text, width = 88) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines.join('\n');
}

function section(area, cases) {
  const lines = [`### ${area.title}`, '', wrap(area.blurb), ''];
  for (const { name, line } of cases) {
    const anchor = line === undefined ? '' : `#L${line}`;
    lines.push(`- [${name}](../${area.file}${anchor})`);
  }
  lines.push('');
  return lines.join('\n');
}

function generate(real, mock) {
  const seen = new Set(AREAS.map((area) => area.file));
  for (const file of real.keys()) {
    // Only `src/` is the library's own suite. `scripts/` holds unit tests for the
    // repository's tooling, which prove nothing about delivery.
    if (file.startsWith('src/') && !seen.has(file)) {
      throw new Error(
        `${file} is not in the area table in scripts/conformance-report.mjs. ` +
          'Add it with a title and a one-line description so its cases are reported.',
      );
    }
  }

  const verified = [];
  const smocketOnly = [];
  for (const area of AREAS) {
    const cases = collect(area, real, mock);
    (hasOracle(area.file) ? verified : smocketOnly).push(section(area, cases));
  }

  const oracle = JSON.parse(
    readFileSync(join(root, 'node_modules', 'socket.io', 'package.json'), 'utf8'),
  ).version;

  return [
    '## Verified against real socket.io',
    '',
    wrap(
      `Every case below ran against socket.io ${oracle} first and against smocket second, from ` +
        'the same test file, and passed on both. Each links to the test that pins it.',
    ),
    '',
    ...verified,
    '## smocket only',
    '',
    wrap(
      'These have no oracle to compare against: they cover the API smocket adds ' +
        '([differences.md §B](./differences.md#b-what-smocket-adds-that-socketio-has-no-equivalent-for)) ' +
        'and the internals behind it, so they run the same under both targets. They are listed ' +
        'apart because nothing about socket.io follows from them.',
    ),
    '',
    ...smocketOnly,
  ].join('\n');
}

function splice(existing, generated) {
  const start = existing.indexOf(START);
  const end = existing.indexOf(END);
  if (start === -1 || end === -1) {
    throw new Error(`docs/conformance.md is missing the ${START} / ${END} markers.`);
  }
  return `${existing.slice(0, start + START.length)}\n\n${generated}\n${existing.slice(end)}`;
}

async function main() {
  const check = process.argv.includes('--check');
  const outDir = mkdtempSync(join(tmpdir(), 'smocket-conformance-'));
  let real;
  let mock;
  try {
    real = index(runProject('real', outDir));
    mock = index(runProject('mock', outDir));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }

  const existing = readFileSync(reportPath, 'utf8');
  // Format the whole file the way the repository formats every other one, so the
  // generated text cannot fail `format:check` and `--check` compares like for like.
  const next = await prettier.format(splice(existing, generate(real, mock)), {
    ...(await prettier.resolveConfig(reportPath)),
    filepath: reportPath,
  });

  if (check) {
    if (next !== existing) {
      console.error(
        'docs/conformance.md is out of date with the suite. Run `pnpm conformance` and commit the result.',
      );
      process.exit(1);
    }
    console.log('docs/conformance.md matches the suite.');
    return;
  }

  writeFileSync(reportPath, next);
  console.log('Wrote docs/conformance.md.');
}

await main();
