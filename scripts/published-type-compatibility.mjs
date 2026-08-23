import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

const exactVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

export function parseExactVersion(value) {
  const match = exactVersionPattern.exec(value);
  assert.ok(match, `invalid exact npm version: ${value}`);
  return {
    raw: value,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  };
}

function comparePrerelease(left, right) {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length ? 0 : left.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : undefined;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) return leftNumber - rightNumber;
    if (leftNumber !== undefined) return -1;
    if (rightNumber !== undefined) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

export function compareExactVersions(leftValue, rightValue) {
  const left = typeof leftValue === 'string' ? parseExactVersion(leftValue) : leftValue;
  const right = typeof rightValue === 'string' ? parseExactVersion(rightValue) : rightValue;
  for (const field of ['major', 'minor', 'patch']) {
    const difference = left[field] - right[field];
    if (difference !== 0) return difference;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function selectPublishedPredecessor(versions, candidateVersion) {
  parseExactVersion(candidateVersion);
  return versions
    .filter((version) => {
      try {
        return compareExactVersions(version, candidateVersion) < 0;
      } catch {
        return false;
      }
    })
    .sort(compareExactVersions)
    .at(-1);
}

export function versionChangePlan(baseManifests, currentManifests) {
  const packageNames = ['smocket', 'smocket-client'];
  const changes = [];
  for (const packageName of packageNames) {
    const previous = baseManifests[packageName];
    const candidate = currentManifests[packageName];
    assert.equal(previous?.name, packageName, `base manifest must describe ${packageName}`);
    assert.equal(candidate?.name, packageName, `current manifest must describe ${packageName}`);
    parseExactVersion(previous.version);
    parseExactVersion(candidate.version);
    if (previous.version === candidate.version) continue;
    assert.ok(
      compareExactVersions(candidate.version, previous.version) > 0,
      `${packageName} version must increase from ${previous.version}, found ${candidate.version}`,
    );
    changes.push({
      packageName,
      baseVersion: previous.version,
      candidateVersion: candidate.version,
    });
  }

  if (changes.length > 0) {
    assert.equal(
      changes.length,
      packageNames.length,
      'release package versions must change together',
    );
    assert.equal(
      currentManifests.smocket.version,
      currentManifests['smocket-client'].version,
      'release package versions must remain synchronized',
    );
    assert.equal(
      currentManifests['smocket-client'].peerDependencies?.smocket,
      currentManifests.smocket.version,
      'smocket-client must keep an exact peer on the synchronized smocket version',
    );
  }
  return changes;
}

export function breakingTypeBumpIsAdequate(previousVersion, candidateVersion) {
  const previous = parseExactVersion(previousVersion);
  const candidate = parseExactVersion(candidateVersion);
  if (compareExactVersions(candidate, previous) <= 0) return false;
  return previous.major === 0
    ? candidate.major > 0 || candidate.minor > previous.minor
    : candidate.major > previous.major;
}

export function requiredBreakingTypeBump(previousVersion) {
  return parseExactVersion(previousVersion).major === 0 ? 'minor' : 'major';
}

function hasModifier(declaration, kind) {
  return declaration.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function isPublicDeclaration(ts, declaration) {
  return (
    !hasModifier(declaration, ts.SyntaxKind.PrivateKeyword) &&
    !hasModifier(declaration, ts.SyntaxKind.ProtectedKeyword)
  );
}

function resolveAlias(ts, checker, symbol) {
  return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
}

function moduleExports(ts, checker, sourceFile) {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  assert.ok(moduleSymbol, `TypeScript could not read exports from ${sourceFile.fileName}`);
  return new Map(
    checker
      .getExportsOfModule(moduleSymbol)
      .map((symbol) => [symbol.getName(), resolveAlias(ts, checker, symbol)]),
  );
}

function bindingNames(ts, name) {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(ts, element.name),
  );
}

function explicitExportNames(ts, sourceFile, availableNames) {
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause) {
        for (const name of availableNames) names.add(name);
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.add(element.name.text);
      } else if (ts.isNamespaceExport(statement.exportClause)) {
        names.add(statement.exportClause.name.text);
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      names.add('default');
      continue;
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      names.add('default');
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(ts, declaration.name)) names.add(name);
      }
    } else if ('name' in statement && statement.name && ts.isIdentifier(statement.name)) {
      names.add(statement.name.text);
    }
  }
  return names;
}

function symbolDeclarations(symbol) {
  return symbol.getDeclarations() ?? [];
}

function publicProperties(ts, checker, type) {
  const result = new Map();
  for (const property of checker.getPropertiesOfType(type)) {
    const declarations = symbolDeclarations(property).filter((declaration) =>
      isPublicDeclaration(ts, declaration),
    );
    if (declarations.length > 0) result.set(property.getName(), { symbol: property, declarations });
  }
  return result;
}

function isReadonly(ts, declarations) {
  return declarations.some((declaration) => {
    if (hasModifier(declaration, ts.SyntaxKind.ReadonlyKeyword)) return true;
    if (!ts.isGetAccessorDeclaration(declaration)) return false;
    const parent = declaration.parent;
    if (!('members' in parent)) return true;
    const name = declaration.name.getText();
    return !parent.members.some(
      (member) => ts.isSetAccessorDeclaration(member) && member.name.getText() === name,
    );
  });
}

function typeAtSymbol(checker, symbol, declarations) {
  return checker.getTypeOfSymbolAtLocation(symbol, declarations[0]);
}

function typeText(ts, checker, type, location) {
  return checker.typeToString(
    type,
    location,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
  );
}

function signatureText(ts, checker, signature, location) {
  return checker.signatureToString(
    signature,
    location,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
  );
}

function normalizedText(value) {
  return value
    .replaceAll('\\', '/')
    .replaceAll(/import\("[^"]*\/previous\/node_modules\//g, 'import("<package>/')
    .replaceAll(/import\("[^"]*\/candidate\/node_modules\//g, 'import("<package>/');
}

function declarationText(ts, declaration) {
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
  return normalizedText(
    printer.printNode(ts.EmitHint.Unspecified, declaration, declaration.getSourceFile()),
  );
}

function declarationsOnlyReferenceLocalOrStandardTypes(ts, checker, declarations) {
  const roots = declarations.map((declaration) => dirname(declaration.getSourceFile().fileName));
  const standardLibraryRoot = dirname(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2022 }));
  let safe = true;

  const visit = (node) => {
    if (!safe) return;
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const specifier = node.argument.literal;
      if (ts.isStringLiteral(specifier)) {
        if (!specifier.text.startsWith('.')) {
          safe = false;
          return;
        }
        const imported = resolve(dirname(node.getSourceFile().fileName), specifier.text);
        const local = roots.some((root) => {
          const path = relative(root, imported);
          return path !== '..' && !path.startsWith(`..${sep}`);
        });
        if (!local) {
          safe = false;
          return;
        }
      }
    }
    if (ts.isIdentifier(node)) {
      const referenced = checker.getSymbolAtLocation(node);
      if (referenced) {
        const resolved = resolveAlias(ts, checker, referenced);
        for (const declaration of symbolDeclarations(resolved)) {
          const source = declaration.getSourceFile();
          const standardLibraryPath = relative(standardLibraryRoot, source.fileName);
          if (
            standardLibraryPath.startsWith('lib.') &&
            standardLibraryPath.endsWith('.d.ts') &&
            !standardLibraryPath.includes(sep)
          ) {
            continue;
          }
          const local = roots.some((root) => {
            const path = relative(root, source.fileName);
            return (
              path !== '..' &&
              !path.startsWith(`..${sep}`) &&
              !path.split(sep).includes('node_modules')
            );
          });
          if (!local) {
            safe = false;
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  for (const declaration of declarations) visit(declaration);
  return safe;
}

function externalReferenceTexts(ts, checker, declarations) {
  const roots = declarations.map((declaration) => dirname(declaration.getSourceFile().fileName));
  const standardLibraryRoot = dirname(ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2022 }));
  const references = [];
  const visited = new Set();

  const collect = (symbol) => {
    const resolved = symbol ? resolveAlias(ts, checker, symbol) : undefined;
    if (!resolved || visited.has(resolved)) return;
    const external = symbolDeclarations(resolved).filter((declaration) => {
      const source = declaration.getSourceFile();
      const standardLibraryPath = relative(standardLibraryRoot, source.fileName);
      if (
        standardLibraryPath.startsWith('lib.') &&
        standardLibraryPath.endsWith('.d.ts') &&
        !standardLibraryPath.includes(sep)
      ) {
        return false;
      }
      return !roots.some((root) => {
        const path = relative(root, source.fileName);
        return path !== '..' && !path.startsWith(`..${sep}`);
      });
    });
    if (external.length === 0) return;
    visited.add(resolved);
    references.push(
      external
        .map((declaration) => declarationText(ts, declaration))
        .sort()
        .join('\n'),
    );
  };

  const visit = (node) => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      collect(checker.getSymbolAtLocation(node.argument.literal));
    }
    if (ts.isIdentifier(node)) collect(checker.getSymbolAtLocation(node));
    ts.forEachChild(node, visit);
  };
  for (const declaration of declarations) visit(declaration);
  return references.sort();
}

function externalReferencesAreTextuallyEqual(ts, checker, previous, candidate) {
  const previousReferences = externalReferenceTexts(ts, checker, previous);
  const candidateReferences = externalReferenceTexts(ts, checker, candidate);
  return (
    previousReferences.length === candidateReferences.length &&
    previousReferences.every((reference, index) => reference === candidateReferences[index])
  );
}

function declarationsAreTextuallyEqual(ts, checker, previous, candidate) {
  const referencesAreSafe =
    (declarationsOnlyReferenceLocalOrStandardTypes(ts, checker, previous) &&
      declarationsOnlyReferenceLocalOrStandardTypes(ts, checker, candidate)) ||
    externalReferencesAreTextuallyEqual(ts, checker, previous, candidate);
  if (!referencesAreSafe) {
    return false;
  }
  const candidateTexts = new Set(candidate.map((declaration) => declarationText(ts, declaration)));
  return previous.some((declaration) => candidateTexts.has(declarationText(ts, declaration)));
}

function signaturesAreTextuallyEqual(
  ts,
  checker,
  previous,
  candidate,
  previousLocation,
  candidateLocation,
) {
  return (
    previous.length === candidate.length &&
    previous.every(
      (signature, index) =>
        normalizedText(signatureText(ts, checker, signature, previousLocation)) ===
        normalizedText(signatureText(ts, checker, candidate[index], candidateLocation)),
    )
  );
}

function expandedTypeText(ts, checker, type, location) {
  return normalizedText(
    checker.typeToString(
      type,
      location,
      ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias,
    ),
  );
}

function expandedSignatureText(ts, checker, signature) {
  const typeParameters = (signature.getTypeParameters() ?? []).map((parameter) => {
    const constraint = checker.getBaseConstraintOfType(parameter);
    return constraint
      ? `${parameter.symbol?.getName() ?? 'T'} extends ${expandedTypeText(
          ts,
          checker,
          constraint,
          parameter.symbol?.getDeclarations()?.[0],
        )}`
      : (parameter.symbol?.getName() ?? 'T');
  });
  const parameters = signature.getParameters().map((parameter) => {
    const declaration = parameterDeclaration(parameter);
    if (!declaration) return parameter.getName();
    const type = checker.getTypeOfSymbolAtLocation(parameter, declaration);
    const rest = declaration.dotDotDotToken ? '...' : '';
    const optional = parameter.flags & ts.SymbolFlags.Optional ? '?' : '';
    return `${rest}${parameter.getName()}${optional}: ${expandedTypeText(
      ts,
      checker,
      type,
      declaration,
    )}`;
  });
  const returns = expandedTypeText(
    ts,
    checker,
    signature.getReturnType(),
    signature.getDeclaration(),
  );
  return `${typeParameters.join(',')}|${parameters.join(',')}|${returns}`;
}

function signaturesHaveSameExpandedTypes(ts, checker, previous, candidate) {
  return (
    previous.length === candidate.length &&
    previous.every(
      (signature, index) =>
        expandedSignatureText(ts, checker, signature) ===
        expandedSignatureText(ts, checker, candidate[index]),
    )
  );
}

function nominalClassType(ts, type) {
  return (type.getSymbol()?.getDeclarations() ?? []).some(
    (declaration) =>
      ts.isClassDeclaration(declaration) &&
      declaration.members.some(
        (member) =>
          hasModifier(member, ts.SyntaxKind.PrivateKeyword) ||
          hasModifier(member, ts.SyntaxKind.ProtectedKeyword),
      ),
  );
}

function textuallyEquivalentIdentity(ts, previousType, candidateType, previousText, candidateText) {
  if (previousText !== candidateText) return false;
  if (
    previousType.flags & ts.TypeFlags.TypeParameter &&
    candidateType.flags & ts.TypeFlags.TypeParameter
  ) {
    return true;
  }
  return nominalClassType(ts, previousType) && nominalClassType(ts, candidateType);
}

function parameterDeclaration(symbol) {
  return symbol.valueDeclaration ?? symbol.getDeclarations()?.[0];
}

function minimumArgumentCount(ts, signature) {
  let count = 0;
  for (const parameter of signature.getParameters()) {
    const declaration = parameterDeclaration(parameter);
    if (
      parameter.flags & ts.SymbolFlags.Optional ||
      declaration?.questionToken ||
      declaration?.initializer ||
      declaration?.dotDotDotToken
    ) {
      break;
    }
    count += 1;
  }
  return count;
}

function signatureAcceptsPreviousCalls({
  ts,
  checker,
  previous,
  candidate,
  previousLocation,
  candidateLocation,
  compareReturn,
}) {
  if (minimumArgumentCount(ts, candidate) > minimumArgumentCount(ts, previous)) return false;

  const previousParameters = previous.getParameters();
  const candidateParameters = candidate.getParameters();
  const previousRest = previousParameters.at(-1)?.valueDeclaration?.dotDotDotToken !== undefined;
  const candidateRest = candidateParameters.at(-1)?.valueDeclaration?.dotDotDotToken !== undefined;
  if (previousRest && !candidateRest) return false;
  if (!candidateRest && candidateParameters.length < previousParameters.length) return false;

  for (const [index, previousParameter] of previousParameters.entries()) {
    const candidateParameter =
      candidateParameters[index] ?? (candidateRest ? candidateParameters.at(-1) : undefined);
    if (!candidateParameter) return false;
    const previousDeclaration = parameterDeclaration(previousParameter);
    const candidateDeclaration = parameterDeclaration(candidateParameter);
    if (!previousDeclaration || !candidateDeclaration) return false;
    const previousType = checker.getTypeOfSymbolAtLocation(previousParameter, previousDeclaration);
    const candidateType = checker.getTypeOfSymbolAtLocation(
      candidateParameter,
      candidateDeclaration,
    );
    const previousTypeText = normalizedText(
      typeText(ts, checker, previousType, previousDeclaration),
    );
    const candidateTypeText = normalizedText(
      typeText(ts, checker, candidateType, candidateDeclaration),
    );
    if (
      !checker.isTypeAssignableTo(previousType, candidateType) &&
      !textuallyEquivalentIdentity(
        ts,
        previousType,
        candidateType,
        previousTypeText,
        candidateTypeText,
      )
    ) {
      return false;
    }
  }

  if (!compareReturn) return true;
  const previousReturn = previous.getReturnType();
  const candidateReturn = candidate.getReturnType();
  const previousReturnText = normalizedText(
    typeText(ts, checker, previousReturn, previousLocation),
  );
  const candidateReturnText = normalizedText(
    typeText(ts, checker, candidateReturn, candidateLocation),
  );
  return (
    checker.isTypeAssignableTo(candidateReturn, previousReturn) ||
    textuallyEquivalentIdentity(
      ts,
      previousReturn,
      candidateReturn,
      previousReturnText,
      candidateReturnText,
    )
  );
}

function everyPreviousSignatureIsAccepted({
  ts,
  checker,
  previous,
  candidate,
  previousLocation,
  candidateLocation,
  compareReturn,
}) {
  return previous.every((previousSignature) =>
    candidate.some((candidateSignature) =>
      signatureAcceptsPreviousCalls({
        ts,
        checker,
        previous: previousSignature,
        candidate: candidateSignature,
        previousLocation,
        candidateLocation,
        compareReturn,
      }),
    ),
  );
}

function compareCallableType({
  ts,
  checker,
  previousType,
  candidateType,
  previousLocation,
  candidateLocation,
  qualifiedName,
  issues,
}) {
  const previousCalls = previousType.getCallSignatures();
  const candidateCalls = candidateType.getCallSignatures();
  const previousConstructs = previousType.getConstructSignatures();
  const candidateConstructs = candidateType.getConstructSignatures();

  if (previousCalls.length > 0) {
    if (
      !everyPreviousSignatureIsAccepted({
        ts,
        checker,
        previous: previousCalls,
        candidate: candidateCalls,
        previousLocation,
        candidateLocation,
        compareReturn: true,
      }) &&
      !signaturesAreTextuallyEqual(
        ts,
        checker,
        previousCalls,
        candidateCalls,
        previousLocation,
        candidateLocation,
      )
    ) {
      issues.push({
        shape: qualifiedName,
        reason: 'call signature changed incompatibly',
        previous: previousCalls
          .map((signature) => signatureText(ts, checker, signature, previousLocation))
          .join(' | '),
        candidate: candidateCalls
          .map((signature) => signatureText(ts, checker, signature, candidateLocation))
          .join(' | '),
      });
    }
  }

  if (
    previousConstructs.length > 0 &&
    !everyPreviousSignatureIsAccepted({
      ts,
      checker,
      previous: previousConstructs,
      candidate: candidateConstructs,
      previousLocation,
      candidateLocation,
      compareReturn: false,
    }) &&
    !signaturesAreTextuallyEqual(
      ts,
      checker,
      previousConstructs,
      candidateConstructs,
      previousLocation,
      candidateLocation,
    )
  ) {
    issues.push({
      shape: `${qualifiedName}.constructor`,
      reason: 'constructor signature changed incompatibly',
      previous: previousConstructs
        .map((signature) => signatureText(ts, checker, signature, previousLocation))
        .join(' | '),
      candidate: candidateConstructs
        .map((signature) => signatureText(ts, checker, signature, candidateLocation))
        .join(' | '),
    });
  }
}

function compareObjectType({
  ts,
  checker,
  previousType,
  candidateType,
  previousLocation,
  candidateLocation,
  qualifiedName,
  checkRequiredAdditions = false,
  issues,
}) {
  const previousProperties = publicProperties(ts, checker, previousType);
  const candidateProperties = publicProperties(ts, checker, candidateType);

  for (const [name, previousProperty] of previousProperties) {
    const candidateProperty = candidateProperties.get(name);
    if (!candidateProperty) {
      issues.push({ shape: `${qualifiedName}.${name}`, reason: 'public member was removed' });
      continue;
    }

    if (
      !isReadonly(ts, previousProperty.declarations) &&
      isReadonly(ts, candidateProperty.declarations)
    ) {
      issues.push({
        shape: `${qualifiedName}.${name}`,
        reason: 'writable property became readonly',
      });
    }

    if (
      previousProperty.symbol.flags & ts.SymbolFlags.Optional &&
      !(candidateProperty.symbol.flags & ts.SymbolFlags.Optional)
    ) {
      issues.push({
        shape: `${qualifiedName}.${name}`,
        reason: 'optional property became required',
      });
    }

    const previousPropertyType = typeAtSymbol(
      checker,
      previousProperty.symbol,
      previousProperty.declarations,
    );
    const candidatePropertyType = typeAtSymbol(
      checker,
      candidateProperty.symbol,
      candidateProperty.declarations,
    );
    const previousText = normalizedText(
      typeText(ts, checker, previousPropertyType, previousProperty.declarations[0]),
    );
    const candidateText = normalizedText(
      typeText(ts, checker, candidatePropertyType, candidateProperty.declarations[0]),
    );
    const previousCalls = previousPropertyType.getCallSignatures();
    const candidateCalls = candidatePropertyType.getCallSignatures();
    const isCallable = previousCalls.length > 0;
    const compatible =
      declarationsAreTextuallyEqual(
        ts,
        checker,
        previousProperty.declarations,
        candidateProperty.declarations,
      ) ||
      (isCallable
        ? everyPreviousSignatureIsAccepted({
            ts,
            checker,
            previous: previousCalls,
            candidate: candidateCalls,
            previousLocation: previousProperty.declarations[0],
            candidateLocation: candidateProperty.declarations[0],
            compareReturn: true,
          }) ||
          (externalReferencesAreTextuallyEqual(
            ts,
            checker,
            previousProperty.declarations,
            candidateProperty.declarations,
          ) &&
            signaturesHaveSameExpandedTypes(ts, checker, previousCalls, candidateCalls))
        : checker.isTypeAssignableTo(candidatePropertyType, previousPropertyType) &&
          (isReadonly(ts, previousProperty.declarations) ||
            checker.isTypeAssignableTo(previousPropertyType, candidatePropertyType)));
    const identityFallback = textuallyEquivalentIdentity(
      ts,
      previousPropertyType,
      candidatePropertyType,
      previousText,
      candidateText,
    );
    if (!compatible && !identityFallback) {
      issues.push({
        shape: `${qualifiedName}.${name}`,
        reason: isCallable
          ? 'call signature changed incompatibly'
          : 'property type changed incompatibly',
        previous: previousText,
        candidate: candidateText,
      });
    }
  }

  if (checkRequiredAdditions) {
    for (const [name, candidateProperty] of candidateProperties) {
      if (
        !previousProperties.has(name) &&
        !(candidateProperty.symbol.flags & ts.SymbolFlags.Optional)
      ) {
        issues.push({
          shape: `${qualifiedName}.${name}`,
          reason: 'required public member was added',
        });
      }
    }
  }
}

function compareExportType({ ts, checker, previousSymbol, candidateSymbol, exportName, issues }) {
  const previousDeclarations = symbolDeclarations(previousSymbol);
  const candidateDeclarations = symbolDeclarations(candidateSymbol);
  const previousLocation = previousDeclarations[0];
  const candidateLocation = candidateDeclarations[0];
  if (!previousLocation || !candidateLocation) return;

  const previousHasType = Boolean(previousSymbol.flags & ts.SymbolFlags.Type);
  const candidateHasType = Boolean(candidateSymbol.flags & ts.SymbolFlags.Type);
  if (previousHasType && !candidateHasType) {
    issues.push({ shape: exportName, reason: 'type export was removed' });
  } else if (previousHasType) {
    const previousType = checker.getDeclaredTypeOfSymbol(previousSymbol);
    const candidateType = checker.getDeclaredTypeOfSymbol(candidateSymbol);
    compareCallableType({
      ts,
      checker,
      previousType,
      candidateType,
      previousLocation,
      candidateLocation,
      qualifiedName: exportName,
      issues,
    });
    compareObjectType({
      ts,
      checker,
      previousType,
      candidateType,
      previousLocation,
      candidateLocation,
      qualifiedName: exportName,
      checkRequiredAdditions: previousDeclarations.some((declaration) =>
        ts.isInterfaceDeclaration(declaration),
      ),
      issues,
    });

    if (
      previousType.getProperties().length === 0 &&
      previousType.getCallSignatures().length === 0 &&
      previousType.getConstructSignatures().length === 0
    ) {
      const previousText = normalizedText(typeText(ts, checker, previousType, previousLocation));
      const candidateText = normalizedText(typeText(ts, checker, candidateType, candidateLocation));
      if (
        (!checker.isTypeAssignableTo(previousType, candidateType) ||
          !checker.isTypeAssignableTo(candidateType, previousType)) &&
        !textuallyEquivalentIdentity(ts, previousType, candidateType, previousText, candidateText)
      ) {
        issues.push({
          shape: exportName,
          reason: 'type changed incompatibly',
          previous: previousText,
          candidate: candidateText,
        });
      }
    }
  }

  const previousHasValue = Boolean(previousSymbol.flags & ts.SymbolFlags.Value);
  const candidateHasValue = Boolean(candidateSymbol.flags & ts.SymbolFlags.Value);
  if (previousHasValue && !candidateHasValue) {
    issues.push({ shape: exportName, reason: 'value export was removed' });
  } else if (previousHasValue) {
    const previousType = checker.getTypeOfSymbolAtLocation(previousSymbol, previousLocation);
    const candidateType = checker.getTypeOfSymbolAtLocation(candidateSymbol, candidateLocation);
    compareCallableType({
      ts,
      checker,
      previousType,
      candidateType,
      previousLocation,
      candidateLocation,
      qualifiedName: exportName,
      issues,
    });
    compareObjectType({
      ts,
      checker,
      previousType,
      candidateType,
      previousLocation,
      candidateLocation,
      qualifiedName: exportName,
      issues,
    });
  }
}

function declarationGraph(ts, program, entrySource) {
  const root = dirname(entrySource.fileName);
  const sources = [];
  const pending = [entrySource];
  const visited = new Set();

  while (pending.length > 0) {
    const source = pending.pop();
    if (!source || visited.has(source.fileName)) continue;
    visited.add(source.fileName);
    sources.push(source);

    for (const statement of source.statements) {
      if (
        (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) ||
        !statement.moduleSpecifier ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.moduleSpecifier.text.startsWith('.')
      ) {
        continue;
      }
      const resolved = ts.resolveModuleName(
        statement.moduleSpecifier.text,
        source.fileName,
        program.getCompilerOptions(),
        ts.sys,
      ).resolvedModule?.resolvedFileName;
      if (!resolved) continue;
      const local = relative(root, resolved);
      if (local === '..' || local.startsWith(`..${sep}`)) continue;
      const dependency = program.getSourceFile(resolved);
      if (dependency) pending.push(dependency);
    }
  }

  return sources;
}

function reachableSupportDeclarations(ts, checker, sourceFiles, rootSymbols) {
  const sourceNames = new Set(sourceFiles.map((sourceFile) => sourceFile.fileName));
  const declarations = new Map();
  const pending = [...rootSymbols];
  const visited = new Set();

  while (pending.length > 0) {
    const symbol = resolveAlias(ts, checker, pending.pop());
    if (!symbol || visited.has(symbol)) continue;
    visited.add(symbol);

    for (const declaration of symbolDeclarations(symbol)) {
      if (!sourceNames.has(declaration.getSourceFile().fileName)) continue;
      if (
        (ts.isTypeAliasDeclaration(declaration) ||
          ts.isInterfaceDeclaration(declaration) ||
          ts.isClassDeclaration(declaration) ||
          ts.isEnumDeclaration(declaration)) &&
        declaration.name
      ) {
        const named = declarations.get(declaration.name.text) ?? [];
        named.push(declaration);
        declarations.set(declaration.name.text, named);
      }

      const visit = (node) => {
        if (ts.isIdentifier(node) && node !== declaration.name) {
          const referenced = checker.getSymbolAtLocation(node);
          if (referenced) pending.push(referenced);
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(declaration, visit);
    }
  }
  return declarations;
}

function compareSupportDeclarations({
  ts,
  checker,
  previousSources,
  candidateSources,
  previousExports,
  candidateExports,
  issues,
}) {
  const exportedSymbols = new Set(previousExports.values());
  const previousDeclarations = reachableSupportDeclarations(
    ts,
    checker,
    previousSources,
    previousExports.values(),
  );
  const candidateDeclarations = reachableSupportDeclarations(
    ts,
    checker,
    candidateSources,
    candidateExports.values(),
  );

  for (const [name, previousNamed] of previousDeclarations) {
    const availableCandidates = [...(candidateDeclarations.get(name) ?? [])];
    for (const previousDeclaration of previousNamed) {
      const previousSymbol = checker.getSymbolAtLocation(previousDeclaration.name);
      if (!previousSymbol || exportedSymbols.has(previousSymbol)) continue;
      if (availableCandidates.length === 0) {
        issues.push({ shape: name, reason: 'reachable public type support was removed' });
        continue;
      }
      let candidateIndex = availableCandidates.findIndex((candidateDeclaration) =>
        declarationsAreTextuallyEqual(ts, checker, [previousDeclaration], [candidateDeclaration]),
      );
      if (candidateIndex < 0) {
        candidateIndex = availableCandidates.findIndex((candidateDeclaration) => {
          const candidateSymbol = checker.getSymbolAtLocation(candidateDeclaration.name);
          if (!candidateSymbol) return false;
          const supportIssues = [];
          compareExportType({
            ts,
            checker,
            previousSymbol,
            candidateSymbol,
            exportName: name,
            issues: supportIssues,
          });
          return supportIssues.length === 0;
        });
      }
      if (candidateIndex < 0) {
        issues.push({
          shape: name,
          reason: 'type changed incompatibly',
          previous: declarationText(ts, previousDeclaration),
          candidate: declarationText(ts, availableCandidates[0]),
        });
      } else {
        availableCandidates.splice(candidateIndex, 1);
      }
    }
  }
}

export async function compareDeclarationEntries(previousEntry, candidateEntry) {
  await Promise.all([readFile(previousEntry), readFile(candidateEntry)]);
  const { default: ts } = await import('typescript');
  const previousPath = resolve(previousEntry);
  const candidatePath = resolve(candidateEntry);
  const program = ts.createProgram({
    rootNames: [previousPath, candidatePath],
    options: {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    },
  });
  const checker = program.getTypeChecker();
  const previousSource = program.getSourceFile(previousPath);
  const candidateSource = program.getSourceFile(candidatePath);
  assert.ok(previousSource, `TypeScript did not load ${previousPath}`);
  assert.ok(candidateSource, `TypeScript did not load ${candidatePath}`);

  const previousExports = moduleExports(ts, checker, previousSource);
  const candidateExports = moduleExports(ts, checker, candidateSource);
  const previousExportNames = explicitExportNames(ts, previousSource, previousExports.keys());
  const candidateExportNames = explicitExportNames(ts, candidateSource, candidateExports.keys());
  const previousPublicExports = new Map(
    [...previousExports].filter(([name]) => previousExportNames.has(name)),
  );
  const candidatePublicExports = new Map(
    [...candidateExports].filter(
      ([name]) => previousPublicExports.has(name) && candidateExportNames.has(name),
    ),
  );
  const issues = [];
  for (const [exportName, previousSymbol] of previousPublicExports) {
    const candidateSymbol = candidateExportNames.has(exportName)
      ? candidateExports.get(exportName)
      : undefined;
    if (!candidateSymbol) {
      issues.push({ shape: exportName, reason: 'package export was removed' });
      continue;
    }
    compareExportType({
      ts,
      checker,
      previousSymbol,
      candidateSymbol,
      exportName,
      issues,
    });
  }
  compareSupportDeclarations({
    ts,
    checker,
    previousSources: declarationGraph(ts, program, previousSource),
    candidateSources: declarationGraph(ts, program, candidateSource),
    previousExports: previousPublicExports,
    candidateExports: candidatePublicExports,
    issues,
  });
  return [...new Map(issues.map((issue) => [JSON.stringify(issue), issue])).values()];
}

export async function compareDeclarationFixture(previousEntry, candidateEntry) {
  await Promise.all([readFile(previousEntry), readFile(candidateEntry)]);
  return compareDeclarationEntries(previousEntry, candidateEntry);
}
