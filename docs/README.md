---
slug: /
---

# smocket docs

> **TL;DR** Start with the README quick start, choose the test-runner or
> SharedWorker workflow that matches your application, then use the scope,
> differences, conformance, and troubleshooting pages to answer exact questions.

This page is published at [smocket-site.vercel.app/docs](https://smocket-site.vercel.app/docs).

## Start with Smocket

Smocket reproduces Socket.IO's in-memory delivery and routing rules so frontend and
application tests can exercise rooms, namespaces, broadcasts, and acknowledgements
without starting a network server. The [README quick start](../README.md#quick-start)
is the shortest executable setup and remains the canonical installation example.

From there, choose the path that matches the code you have:

1. Keep an application's `socket.io-client` import with the
   [test-runner integration guide](./test-runner-integration.md).
2. Choose among the four supported imports in the
   [package entry-point guide](./package-entry-points.md).
3. Share one caller-owned mock server across same-origin browser tabs with the
   [SharedWorker workflow](./shared-worker.md).
4. Check the [scope boundary](./scope.md) and
   [differences from real Socket.IO](./differences.md) before relying on an unverified
   surface.
5. Use the [troubleshooting guide](./troubleshooting.md) when setup fails before the
   first application event.

## Understand the guarantees

- [Conformance report](./conformance.md): behaviours compared by the dual run.
- [Adapter registration](./adapter-registration.md): Smocket-only routing extensions.
- [Glossary](./glossary.md): Socket.IO and Smocket terms used by these guides.
- [Roadmap](./roadmap.md): the stable boundary, release gates, and maintained paths.
- [Drawing-game example](../examples/drawing-game/): the same application running
  with Real Socket.IO and Smocket in Node and across browser pages.

## Maintain the project

- [Contributing](../CONTRIBUTING.md) · [한국어](../CONTRIBUTING.ko.md)
- [Documentation guide](./CONTRIBUTING-docs.md)
- [Repository structure](./repository-structure.md) and [script guide](../scripts/README.md)
- [Development lenses](./development-lenses.md)
- [Decisions index](./decisions/README.md)
- [Public surface ledger](./public-surface.md)
- [Package policy](./package-policy.md)
- [Release candidates](./release-candidates.md),
  [npm publication](./npm-publication.md), and
  [release completion](./release-completion.md), and
  [release remediation](./release-remediation.md)
- [Published consumer policy](./published-consumer-policy.md)
- [Issue and pull request labels](./labels.md)
- [Version compatibility decision](./decisions/0019-what-counts-as-a-breaking-change.md)

English documentation is authoritative. Maintained Korean entry points are limited to
the repository [README](../README.ko.md) and [contribution guide](../CONTRIBUTING.ko.md)
so the project does not promise to synchronize every page.
