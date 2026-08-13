# Clean adoption fixtures

These fixtures keep application imports from `socket.io-client` unchanged and let a
test runner map that specifier to an installed root `smocket` package. They are not
workspace packages: `scripts/run-clean-adoption.mjs` copies them into a temporary
directory outside the checkout, installs either an exact registry version or one
packed tarball, and reports the package input and resolved identity.

The runner pins its fixture tools in its generated manifest. Update those versions
alongside the repository toolchain, then run the candidate and published commands
from the root package.
