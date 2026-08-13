import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import ts from 'typescript';

import {
  extractSurface,
  reconcileInventory,
  withOverloadIndexes,
} from './check-public-surface.mjs';

const fixturePath = join(import.meta.dirname, 'fixtures', 'public-surface-drift', 'upstream.d.ts');

function fixtureInventory() {
  const program = ts.createProgram([fixturePath], {
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(fixturePath);
  assert.ok(source);
  const surface = source.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === 'FixtureSurface',
  );
  assert.ok(surface && ts.isClassDeclaration(surface));
  assert.ok(surface.name);
  const symbol = checker.getSymbolAtLocation(surface.name);
  assert.ok(symbol);
  const entries = withOverloadIndexes(
    extractSurface({
      checker,
      symbol,
      packageName: 'fixture-upstream',
      packagePath: import.meta.dirname,
      packageVersion: '1.0.0',
      receiver: 'instance',
      supportLine: '1.0.0',
      surface: 'FixtureSurface',
    }),
  );
  return { schemaVersion: 1, entries };
}

test('reports every unclassified fixture key with its exact signature', () => {
  const inventory = fixtureInventory();
  const existing = inventory.entries.find((entry) => entry.member === 'existing');
  assert.ok(existing);
  const added = inventory.entries.filter((entry) => entry.member.startsWith('added'));
  const instanceAdded = added.filter((entry) => entry.member === 'added');
  const staticAdded = added.find((entry) => entry.member === 'addedStatic');
  assert.equal(added.length, 3);
  assert.equal(
    inventory.entries.some((entry) => entry.member === 'hiddenStatic'),
    false,
  );
  assert.ok(staticAdded);
  const errors = reconcileInventory(inventory, {
    schemaVersion: 1,
    inventory: 'public-surface.generated.json',
    dispositions: [
      'ADR-deferred',
      'implemented',
      'non-user-facing',
      'out-of-scope',
      'tracked-issue',
    ],
    entries: [
      {
        id: existing.id,
        disposition: 'implemented',
        reference: 'fixture baseline',
      },
    ],
  });

  assert.deepEqual(errors, [
    `Unclassified public-surface entries (3):\n${added
      .map(
        (entry) =>
          `- ${entry.id}\n` + `  FixtureSurface.${entry.member}\n` + `  ${entry.signature}`,
      )
      .join('\n')}`,
  ]);
  assert.deepEqual(
    instanceAdded.map((entry) => [entry.overloadIndex, entry.signature]),
    [
      [0, 'added(value: string): void;'],
      [1, 'added(value: number): number;'],
    ],
  );
  assert.equal(staticAdded.receiver, 'static');
  assert.equal(staticAdded.overloadIndex, 0);
  assert.equal(staticAdded.signature, 'static addedStatic(value: boolean): boolean;');
});
