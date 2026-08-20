import assert from 'node:assert/strict';

export function assertCandidatePackageIdentities(
  installedPackage,
  installedClientPackage,
  expectedVersion,
) {
  assert.equal(installedPackage.name, 'smocket', 'root candidate must install smocket');
  assert.equal(
    installedClientPackage.name,
    'smocket-client',
    'client candidate must install smocket-client',
  );
  assert.equal(
    installedPackage.version,
    expectedVersion,
    `root candidate version must match ${expectedVersion}`,
  );
  assert.equal(
    installedClientPackage.version,
    expectedVersion,
    `client candidate version must match ${expectedVersion}`,
  );
}
