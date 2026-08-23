# npm publication workflow

> **TL;DR** A maintainer manually starts `release.yml` on `main`. The workflow
> verifies one two-package candidate, publishes `smocket` before `smocket-client`
> through npm trusted publishing, and certifies only the exact published pair.

## Publication authority

`release.yml` has only a `workflow_dispatch` trigger. Its first job rejects any
repository other than `electrohyun/smocket` and any ref other than `main`. Pull
requests and forks therefore run no registry mutation path.

The two publish jobs use GitHub-hosted runners, the `npm` environment, and only
`contents: read` plus `id-token: write`. The latter lets npm exchange one short-lived
GitHub OIDC identity; it is not repository write permission. No npm token is stored in
the workflow.

Configure each npm package with the same trusted publisher:

- provider: GitHub Actions;
- repository: `electrohyun/smocket`;
- workflow filename: `release.yml`;
- environment: `npm`;
- allowed action: `npm publish`.

Configure the GitHub `npm` environment to require maintainer approval and allow only
`main`. Those protection rules and npm ownership remain repository and npm account
settings rather than checked-in credentials. The workflow does not change npm 2FA,
token, or package publishing-access settings.

## Release chain

> [!CAUTION]
> Publish `smocket` first and the same exact version of `smocket-client` second. Do not
> start or repeat either package operation outside the authorized workflow sequence.

Start **Publish release** from the Actions page on `main` and provide the exact package
version. The workflow then:

1. runs quality, dual-target, conformance, public-surface, Socket.IO 4.7 and 4.8,
   package, clean-consumer, and Chromium candidate checks;
2. records and uploads one manifest with both tarball sizes and SHA-256 digests;
3. downloads and reverifies that manifest before publishing `smocket`;
4. repeats the download and digest verification before publishing `smocket-client`;
5. waits for both exact registry versions and exercises their shared registry outside
   the checkout.

The root and client publishes are separate jobs. If the client publish or final
verification fails, follow the [remediation runbook](./release-remediation.md) and rerun
only the failed jobs after recording the incident. Do not rerun a successful publish
job or rebuild its artifact set.

A successful exact-version verification job is the certification signal. GitHub tags
and Releases neither trigger this workflow nor replace that signal.
