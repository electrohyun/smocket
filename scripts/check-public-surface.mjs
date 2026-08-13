import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inventoryPath = join(root, 'docs', 'public-surface.generated.json');
const ledgerPath = join(root, 'docs', 'public-surface-ledger.json');
const packageJsonPath = join(root, 'package.json');

const tiers = new Set(['declaration-public', 'officially-documented', 'runtime-only']);
const dispositions = new Set([
  'implemented',
  'tracked-issue',
  'ADR-deferred',
  'out-of-scope',
  'non-user-facing',
]);

const targets = [
  {
    line: '4.7.5',
    server: { alias: 'socket.io-4.7', name: 'socket.io', version: '4.7.5' },
    client: {
      alias: 'socket.io-client-4.7',
      name: 'socket.io-client',
      version: '4.7.5',
    },
  },
  {
    line: '4.8.3',
    server: { alias: 'socket.io-4.8', name: 'socket.io', version: '4.8.3' },
    client: {
      alias: 'socket.io-client-4.8',
      name: 'socket.io-client',
      version: '4.8.3',
    },
  },
];

const printer = ts.createPrinter({
  newLine: ts.NewLineKind.LineFeed,
  removeComments: true,
});

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stable(child)]),
    );
  }
  return value;
}

function json(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function packageRoot(alias) {
  const path = join(root, 'node_modules', alias);
  if (!existsSync(path)) {
    throw new Error(`Missing exact public-surface dependency ${alias}; run pnpm install`);
  }
  return realpathSync(path);
}

function verifyPackage(specification) {
  const path = packageRoot(specification.alias);
  const manifest = readJson(join(path, 'package.json'));
  if (manifest.name !== specification.name || manifest.version !== specification.version) {
    throw new Error(
      `${specification.alias} resolved to ${manifest.name}@${manifest.version}; ` +
        `expected ${specification.name}@${specification.version}`,
    );
  }
  return { manifest, path };
}

function containingPackage(entryPath) {
  let directory = dirname(entryPath);
  while (directory !== dirname(directory)) {
    const manifestPath = join(directory, 'package.json');
    if (existsSync(manifestPath)) return directory;
    directory = dirname(directory);
  }
  throw new Error(`Could not find a package root for ${entryPath}`);
}

function packageTypesPath(path, manifest) {
  const typesPath = manifest.types ?? manifest.typings;
  if (typeof typesPath !== 'string') {
    throw new Error(`${manifest.name}@${manifest.version} has no types entry`);
  }
  return join(path, typesPath);
}

function adapterForServer(serverPath) {
  const requireFromServer = createRequire(join(serverPath, 'package.json'));
  const adapterEntry = requireFromServer.resolve('socket.io-adapter');
  const path = containingPackage(adapterEntry);
  const manifest = readJson(join(path, 'package.json'));
  if (manifest.name !== 'socket.io-adapter' || manifest.version !== '2.5.8') {
    throw new Error(
      `socket.io resolved ${manifest.name}@${manifest.version}; ` +
        'expected socket.io-adapter@2.5.8',
    );
  }
  return { manifest, path };
}

function pathWithinPackage(path, packagePath) {
  const local = relative(packagePath, path).split(sep).join('/');
  if (local !== '..' && !local.startsWith('../')) return local;
  const dependencyPath = containingPackage(path);
  const dependency = readJson(join(dependencyPath, 'package.json'));
  const dependencyFile = relative(dependencyPath, path).split(sep).join('/');
  return `${dependency.name}/${dependencyFile}`;
}

function declarationOwner(declaration) {
  let current = declaration.parent;
  while (current) {
    if (
      (ts.isClassDeclaration(current) ||
        ts.isInterfaceDeclaration(current) ||
        ts.isTypeAliasDeclaration(current) ||
        ts.isModuleDeclaration(current)) &&
      current.name
    ) {
      return current.name.getText();
    }
    current = current.parent;
  }
  return '<module>';
}

function hasModifier(declaration, kind) {
  return declaration.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function isPublic(declaration) {
  return (
    !hasModifier(declaration, ts.SyntaxKind.PrivateKeyword) &&
    !hasModifier(declaration, ts.SyntaxKind.ProtectedKeyword)
  );
}

function evidenceTier(declaration) {
  const tags = ts.getJSDocTags(declaration).map((tag) => tag.tagName.text.toLowerCase());
  return tags.includes('private') || tags.includes('internal')
    ? 'runtime-only'
    : 'declaration-public';
}

function declarationKind(declaration) {
  if (ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration)) {
    return 'method';
  }
  if (ts.isGetAccessorDeclaration(declaration)) return 'getter';
  if (ts.isSetAccessorDeclaration(declaration)) return 'setter';
  if (ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration)) {
    return 'property';
  }
  if (ts.isConstructorDeclaration(declaration)) return 'constructor';
  if (ts.isCallSignatureDeclaration(declaration)) return 'call-signature';
  if (ts.isFunctionDeclaration(declaration)) return 'function';
  if (ts.isTypeAliasDeclaration(declaration)) return 'type';
  if (ts.isInterfaceDeclaration(declaration)) return 'interface';
  if (ts.isClassDeclaration(declaration)) return 'class';
  if (ts.isEnumDeclaration(declaration)) return 'enum';
  if (ts.isVariableDeclaration(declaration)) return 'variable';
  return ts.SyntaxKind[declaration.kind] ?? 'unknown';
}

function canonicalDeclaration(declaration) {
  return printer
    .printNode(ts.EmitHint.Unspecified, declaration, declaration.getSourceFile())
    .trim();
}

function packageDeclarationSignature(declaration) {
  if (!ts.isClassDeclaration(declaration)) {
    return canonicalDeclaration(declaration);
  }
  const typeParameters = declaration.typeParameters
    ? `<${declaration.typeParameters.map(canonicalDeclaration).join(', ')}>`
    : '';
  const heritage = declaration.heritageClauses?.map(canonicalDeclaration).join(' ');
  return `class ${declaration.name?.text ?? '<anonymous>'}${typeParameters}${
    heritage ? ` ${heritage}` : ''
  }`;
}

function readonlyState(declaration) {
  if (hasModifier(declaration, ts.SyntaxKind.ReadonlyKeyword)) return true;
  if (!ts.isGetAccessorDeclaration(declaration)) return false;
  const parent = declaration.parent;
  if (!('members' in parent)) return true;
  const name = declaration.name.getText();
  return !parent.members.some(
    (member) => ts.isSetAccessorDeclaration(member) && member.name.getText() === name,
  );
}

function slug(value) {
  return value.replaceAll(/[^a-zA-Z0-9._-]+/g, '-');
}

function entryId(entry) {
  const digest = createHash('sha256')
    .update(
      JSON.stringify([
        entry.tier,
        entry.package,
        entry.packageVersion,
        entry.supportLine,
        entry.surface,
        entry.receiver,
        entry.member,
        entry.kind,
        entry.declaredBy,
        entry.readonly,
        entry.optional,
        entry.signature,
      ]),
    )
    .digest('hex')
    .slice(0, 12);
  return [
    `${entry.package}@${entry.packageVersion}`,
    entry.supportLine,
    entry.tier,
    entry.surface,
    entry.receiver,
    entry.member,
    entry.kind,
    digest,
  ]
    .map(slug)
    .join(':');
}

function withId(entry) {
  return { id: entryId(entry), ...entry };
}

function compareEntries(left, right) {
  const fields = [
    'supportLine',
    'package',
    'packageVersion',
    'tier',
    'surface',
    'receiver',
    'member',
    'kind',
    'declaredBy',
    'signature',
  ];
  for (const field of fields) {
    const comparison = String(left[field]).localeCompare(String(right[field]));
    if (comparison !== 0) return comparison;
  }
  return 0;
}

export function withOverloadIndexes(entries) {
  const indexes = new Map();
  const callableKinds = new Set(['call-signature', 'constructor', 'function', 'method']);
  return entries.map((entry) => {
    if (!callableKinds.has(entry.kind)) return { ...entry, overloadIndex: null };
    const key = [
      entry.supportLine,
      entry.package,
      entry.packageVersion,
      entry.tier,
      entry.surface,
      entry.receiver,
      entry.member,
      entry.kind,
      entry.declaredBy,
    ].join('\u0000');
    const overloadIndex = indexes.get(key) ?? 0;
    indexes.set(key, overloadIndex + 1);
    return { ...entry, overloadIndex };
  });
}

function sourceModuleSymbol(checker, sourceFile) {
  const symbol = checker.getSymbolAtLocation(sourceFile);
  if (!symbol) throw new Error(`No module symbol for ${sourceFile.fileName}`);
  return symbol;
}

function resolveAlias(checker, symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function exportedSymbol(checker, sourceFile, name) {
  const found = checker
    .getExportsOfModule(sourceModuleSymbol(checker, sourceFile))
    .find((symbol) => symbol.getName() === name);
  if (!found) throw new Error(`${name} is not exported by ${sourceFile.fileName}`);
  return resolveAlias(checker, found);
}

function namedClassSymbol(checker, sourceFile, name) {
  const declaration = sourceFile.statements.find(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === name,
  );
  if (!declaration?.name) {
    throw new Error(`${name} is not declared by ${sourceFile.fileName}`);
  }
  const symbol = checker.getSymbolAtLocation(declaration.name);
  if (!symbol) throw new Error(`No symbol for ${name} in ${sourceFile.fileName}`);
  return symbol;
}

function memberDeclarations(symbol) {
  return (symbol.getDeclarations() ?? []).filter(
    (declaration) =>
      isPublic(declaration) &&
      (ts.isMethodDeclaration(declaration) ||
        ts.isMethodSignature(declaration) ||
        ts.isGetAccessorDeclaration(declaration) ||
        ts.isSetAccessorDeclaration(declaration) ||
        ts.isPropertyDeclaration(declaration) ||
        ts.isPropertySignature(declaration)),
  );
}

function publicMemberName(symbol, declaration) {
  return declaration.name && ts.isComputedPropertyName(declaration.name)
    ? declaration.name.getText()
    : symbol.getName();
}

export function extractSurface({
  checker,
  symbol,
  packageName,
  packagePath,
  packageVersion,
  receiver,
  supportLine,
  surface,
}) {
  const type = checker.getDeclaredTypeOfSymbol(symbol);
  const declarations = symbol.getDeclarations() ?? [];
  const entries = [];

  for (const declaration of declarations) {
    if (!ts.isClassDeclaration(declaration)) continue;
    for (const constructor of declaration.members.filter(ts.isConstructorDeclaration)) {
      if (!isPublic(constructor)) continue;
      entries.push(
        withId({
          supportLine,
          package: packageName,
          packageVersion,
          tier: evidenceTier(constructor),
          surface,
          receiver,
          member: 'constructor',
          kind: 'constructor',
          declaredBy: declaration.name?.text ?? surface,
          declarationFile: pathWithinPackage(constructor.getSourceFile().fileName, packagePath),
          readonly: false,
          optional: false,
          signature: canonicalDeclaration(constructor),
        }),
      );
    }
  }

  for (const member of checker.getPropertiesOfType(type)) {
    for (const declaration of memberDeclarations(member)) {
      entries.push(
        withId({
          supportLine,
          package: packageName,
          packageVersion,
          tier: evidenceTier(declaration),
          surface,
          receiver,
          member: publicMemberName(member, declaration),
          kind: declarationKind(declaration),
          declaredBy: declarationOwner(declaration),
          declarationFile: pathWithinPackage(declaration.getSourceFile().fileName, packagePath),
          readonly: readonlyState(declaration),
          optional: Boolean(declaration.questionToken),
          signature: canonicalDeclaration(declaration),
        }),
      );
    }
  }

  return entries;
}

function packageExportKind(symbol) {
  const hasType = Boolean(
    symbol.flags &
    (ts.SymbolFlags.Type |
      ts.SymbolFlags.Interface |
      ts.SymbolFlags.TypeAlias |
      ts.SymbolFlags.Class),
  );
  const hasValue = Boolean(symbol.flags & ts.SymbolFlags.Value);
  if (hasType && hasValue) return 'type-and-value-export';
  if (hasType) return 'type-export';
  return 'value-export';
}

function extractPackageSymbols({
  checker,
  sourceFile,
  packageName,
  packagePath,
  packageVersion,
  supportLine,
}) {
  const entries = [];
  for (const exported of checker.getExportsOfModule(sourceModuleSymbol(checker, sourceFile))) {
    const symbol = resolveAlias(checker, exported);
    const declarations = (symbol.getDeclarations() ?? []).filter(isPublic);
    const signatures = declarations.length > 0 ? declarations : [undefined];
    for (const declaration of signatures) {
      const entry = {
        supportLine,
        package: packageName,
        packageVersion,
        tier: declaration ? evidenceTier(declaration) : 'declaration-public',
        surface: 'package root',
        receiver: 'module',
        member: exported.getName(),
        kind: packageExportKind(symbol),
        declaredBy: packageName,
        declarationFile: declaration
          ? pathWithinPackage(declaration.getSourceFile().fileName, packagePath)
          : pathWithinPackage(sourceFile.fileName, packagePath),
        readonly: false,
        optional: false,
        signature: declaration
          ? packageDeclarationSignature(declaration)
          : `${exported.getName()}: unknown export`,
      };
      entries.push(withId(entry));
    }
  }
  return entries;
}

function extractExportMap({ manifest, packageName, packageVersion, supportLine }) {
  const declaredExports = manifest.exports ?? manifest.main;
  const exportMap =
    declaredExports &&
    typeof declaredExports === 'object' &&
    !Array.isArray(declaredExports) &&
    Object.keys(declaredExports).every((key) => key.startsWith('.'))
      ? declaredExports
      : { '.': declaredExports };
  return Object.entries(exportMap).map(([subpath, target]) =>
    withId({
      supportLine,
      package: packageName,
      packageVersion,
      tier: 'declaration-public',
      surface: 'package export map',
      receiver: 'module',
      member: subpath,
      kind: 'package-subpath',
      declaredBy: `${packageName}/package.json`,
      declarationFile: 'package.json',
      readonly: true,
      optional: false,
      signature: JSON.stringify(stable(target)),
    }),
  );
}

function supplementalEntries(supportLine) {
  const common = {
    supportLine,
    readonly: true,
    optional: false,
  };
  return [
    withId({
      ...common,
      package: 'socket.io',
      packageVersion: supportLine,
      tier: 'officially-documented',
      surface: 'package root',
      receiver: 'CommonJS module',
      member: 'callable root',
      kind: 'function',
      declaredBy: 'Socket.IO server initialization documentation',
      declarationFile: null,
      signature: 'require("socket.io")(httpServerOrPort[, options])',
      source: 'https://socket.io/docs/v4/server-initialization/',
    }),
    ...['addEventListener', 'removeEventListener'].map((member) =>
      withId({
        ...common,
        package: 'socket.io-client',
        packageVersion: supportLine,
        tier: 'runtime-only',
        surface: 'client Socket',
        receiver: 'instance',
        member,
        kind: 'method',
        declaredBy: '@socket.io/component-emitter',
        declarationFile: null,
        signature:
          member === 'addEventListener'
            ? 'addEventListener(event, listener): this'
            : 'removeEventListener(event?, listener?): this',
        source:
          'https://github.com/socketio/socket.io-component-emitter/blob/3.1.2/lib/cjs/index.js',
      }),
    ),
  ];
}

function createProgram(rootNames) {
  const program = ts.createProgram({
    rootNames,
    options: {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      skipLibCheck: true,
      types: ['node'],
    },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (path) => path,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      }),
    );
  }
  return program;
}

function sourceFile(program, path) {
  const file = program.getSourceFile(path);
  if (!file) throw new Error(`TypeScript did not load ${path}`);
  return file;
}

export function generateInventory() {
  const rootManifest = readJson(packageJsonPath);
  if (rootManifest.devDependencies?.typescript !== ts.version) {
    throw new Error(
      `Extractor uses TypeScript ${ts.version}, but package.json pins ` +
        `${rootManifest.devDependencies?.typescript ?? '<nothing>'}`,
    );
  }

  const entries = [];
  const resolutions = [];
  for (const target of targets) {
    const server = verifyPackage(target.server);
    const client = verifyPackage(target.client);
    const adapter = adapterForServer(server.path);
    const serverEntry = packageTypesPath(server.path, server.manifest);
    const clientEntry = packageTypesPath(client.path, client.manifest);
    const adapterEntry = packageTypesPath(adapter.path, adapter.manifest);
    const parentEntry = join(server.path, 'dist', 'parent-namespace.d.ts');
    const program = createProgram([serverEntry, clientEntry, adapterEntry, parentEntry]);
    const checker = program.getTypeChecker();
    const serverSource = sourceFile(program, serverEntry);
    const clientSource = sourceFile(program, clientEntry);
    const adapterSource = sourceFile(program, adapterEntry);
    const parentSource = sourceFile(program, parentEntry);

    resolutions.push({
      supportLine: target.line,
      packages: [
        {
          alias: target.server.alias,
          name: server.manifest.name,
          version: server.manifest.version,
          types: pathWithinPackage(serverEntry, server.path),
        },
        {
          alias: target.client.alias,
          name: client.manifest.name,
          version: client.manifest.version,
          types: pathWithinPackage(clientEntry, client.path),
        },
        {
          resolvedFrom: target.server.alias,
          name: adapter.manifest.name,
          version: adapter.manifest.version,
          types: pathWithinPackage(adapterEntry, adapter.path),
        },
      ],
    });

    entries.push(
      ...extractExportMap({
        manifest: server.manifest,
        packageName: server.manifest.name,
        packageVersion: server.manifest.version,
        supportLine: target.line,
      }),
      ...extractExportMap({
        manifest: client.manifest,
        packageName: client.manifest.name,
        packageVersion: client.manifest.version,
        supportLine: target.line,
      }),
      ...extractPackageSymbols({
        checker,
        sourceFile: serverSource,
        packageName: server.manifest.name,
        packagePath: server.path,
        packageVersion: server.manifest.version,
        supportLine: target.line,
      }),
      ...extractPackageSymbols({
        checker,
        sourceFile: clientSource,
        packageName: client.manifest.name,
        packagePath: client.path,
        packageVersion: client.manifest.version,
        supportLine: target.line,
      }),
    );

    const surfaces = [
      {
        symbol: exportedSymbol(checker, serverSource, 'Server'),
        package: server,
        surface: 'Server',
      },
      {
        symbol: exportedSymbol(checker, serverSource, 'Namespace'),
        package: server,
        surface: 'Namespace',
      },
      {
        symbol: namedClassSymbol(checker, parentSource, 'ParentNamespace'),
        package: server,
        surface: 'ParentNamespace',
      },
      {
        symbol: exportedSymbol(checker, serverSource, 'BroadcastOperator'),
        package: server,
        surface: 'BroadcastOperator',
      },
      {
        symbol: exportedSymbol(checker, serverSource, 'Socket'),
        package: server,
        surface: 'server Socket',
      },
      {
        symbol: exportedSymbol(checker, clientSource, 'Socket'),
        package: client,
        surface: 'client Socket',
      },
      {
        symbol: exportedSymbol(checker, clientSource, 'Manager'),
        package: client,
        surface: 'Manager',
      },
      {
        symbol: exportedSymbol(checker, adapterSource, 'Adapter'),
        package: adapter,
        surface: 'built-in Adapter',
      },
    ];

    for (const item of surfaces) {
      entries.push(
        ...extractSurface({
          checker,
          symbol: item.symbol,
          packageName: item.package.manifest.name,
          packagePath: item.package.path,
          packageVersion: item.package.manifest.version,
          receiver: 'instance',
          supportLine: target.line,
          surface: item.surface,
        }),
      );
    }
    entries.push(...supplementalEntries(target.line));
  }

  const duplicateIds = entries
    .map((entry) => entry.id)
    .filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new Error(`Duplicate generated ids:\n${duplicateIds.join('\n')}`);
  }

  return {
    schemaVersion: 1,
    generatedBy: 'scripts/check-public-surface.mjs',
    toolchain: {
      packageManager: readJson(packageJsonPath).packageManager,
      typescript: ts.version,
    },
    resolutions,
    entries: withOverloadIndexes(entries.sort(compareEntries)),
  };
}

function formatEntry(entry) {
  return `${entry.id}\n  ${entry.surface}.${entry.member}\n  ${entry.signature}`;
}

export function reconcileInventory(inventory, ledger) {
  const errors = [];
  if (inventory.schemaVersion !== 1) {
    errors.push(`Unsupported inventory schema ${inventory.schemaVersion}`);
  }
  if (ledger.schemaVersion !== 1) {
    errors.push(`Unsupported ledger schema ${ledger.schemaVersion}`);
  }
  if (ledger.inventory !== 'public-surface.generated.json') {
    errors.push(`Ledger points at unexpected inventory ${ledger.inventory}`);
  }
  const declaredDispositions = [...(ledger.dispositions ?? [])].sort();
  const expectedDispositions = [...dispositions].sort();
  if (JSON.stringify(declaredDispositions) !== JSON.stringify(expectedDispositions)) {
    errors.push('Ledger disposition vocabulary has drifted');
  }
  const inventoryById = new Map(inventory.entries.map((entry) => [entry.id, entry]));
  const ledgerIds = ledger.entries.map((entry) => entry.id);
  const duplicateLedgerIds = ledgerIds.filter((id, index) => ledgerIds.indexOf(id) !== index);
  if (duplicateLedgerIds.length > 0) {
    errors.push(
      `Duplicate ledger classifications (${duplicateLedgerIds.length}):\n` +
        duplicateLedgerIds.map((id) => `- ${id}`).join('\n'),
    );
  }

  const classified = new Set(ledgerIds);
  const unclassified = inventory.entries.filter((entry) => !classified.has(entry.id));
  if (unclassified.length > 0) {
    errors.push(
      `Unclassified public-surface entries (${unclassified.length}):\n` +
        unclassified.map((entry) => `- ${formatEntry(entry)}`).join('\n'),
    );
  }

  const stale = ledger.entries.filter((entry) => !inventoryById.has(entry.id));
  if (stale.length > 0) {
    errors.push(
      `Stale ledger classifications (${stale.length}):\n` +
        stale.map((entry) => `- ${entry.id}`).join('\n'),
    );
  }

  for (const entry of inventory.entries) {
    if (!tiers.has(entry.tier)) {
      errors.push(`${entry.id} has invalid tier ${entry.tier}`);
    }
    const callable = ['call-signature', 'constructor', 'function', 'method'].includes(entry.kind);
    if (callable !== Number.isInteger(entry.overloadIndex)) {
      errors.push(`${entry.id} has an invalid overload index`);
    }
  }
  for (const entry of ledger.entries) {
    const keys = Object.keys(entry).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['disposition', 'id', 'reference'])) {
      errors.push(`${entry.id ?? '<missing id>'} has unexpected ledger fields`);
    }
    if (!dispositions.has(entry.disposition)) {
      errors.push(`${entry.id} has invalid disposition ${entry.disposition}`);
    }
    if (typeof entry.reference !== 'string' || entry.reference.length === 0) {
      errors.push(`${entry.id} has no classification reference`);
    }
    if (
      entry.disposition === 'tracked-issue' &&
      !/^https:\/\/github\.com\/electrohyun\/smocket\/issues\/\d+$/.test(entry.reference)
    ) {
      errors.push(`${entry.id} does not reference a tracked issue`);
    }
    if (entry.disposition === 'ADR-deferred' && !entry.reference.startsWith('docs/decisions/')) {
      errors.push(`${entry.id} does not reference an ADR`);
    }
    if (/^(docs|src)\//.test(entry.reference) || entry.reference === 'package.json') {
      if (!existsSync(join(root, entry.reference))) {
        errors.push(`${entry.id} references missing file ${entry.reference}`);
      }
    }
  }

  return errors;
}

function inventoryDrift(committed, generated) {
  if (json(committed) === json(generated)) return [];
  const committedIds = new Set(committed.entries.map((entry) => entry.id));
  const generatedIds = new Set(generated.entries.map((entry) => entry.id));
  const added = generated.entries.filter((entry) => !committedIds.has(entry.id));
  const removed = committed.entries.filter((entry) => !generatedIds.has(entry.id));
  const errors = ['Generated public-surface inventory has drifted.'];
  if (added.length > 0) {
    errors.push(
      `Added or changed upstream entries (${added.length}):\n` +
        added.map((entry) => `- ${formatEntry(entry)}`).join('\n'),
    );
  }
  if (removed.length > 0) {
    errors.push(
      `Removed or changed upstream entries (${removed.length}):\n` +
        removed.map((entry) => `- ${formatEntry(entry)}`).join('\n'),
    );
  }
  return errors;
}

function main() {
  const mode = process.argv[2] ?? '--check';
  const generated = generateInventory();
  if (mode === '--write') {
    writeFileSync(inventoryPath, json(generated));
    return;
  }
  if (mode !== '--check') {
    throw new Error(`Unknown mode ${mode}; use --check or --write`);
  }
  if (!existsSync(inventoryPath) || !existsSync(ledgerPath)) {
    throw new Error(
      'Public-surface inventory or ledger is missing; run the documented regeneration workflow',
    );
  }
  const committed = readJson(inventoryPath);
  const ledger = readJson(ledgerPath);
  const errors = [
    ...inventoryDrift(committed, generated),
    ...reconcileInventory(generated, ledger),
  ];
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n\n')}\n`);
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main();
}
