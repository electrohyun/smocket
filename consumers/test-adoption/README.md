# Clean adoption fixtures

These fixtures keep application imports from `socket.io-client` unchanged. Candidate
validation maps that specifier to the installed `smocket-client` tarball and uses its
exact-version `smocket` peer. Published validation maps it to the installed root package
until the facade has its first release. They are not workspace packages:
`scripts/run-clean-adoption.mjs` copies them into a temporary directory outside the
checkout, installs the selected exact packages, and reports each input and resolved
identity.

The runner pins its fixture tools in its generated manifest. Update those versions
alongside the repository toolchain, then run the candidate and published commands
from the root package.
