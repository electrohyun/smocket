# Security Policy

## Threat surface

smocket is a development dependency. It stands in for a Socket.IO server inside a
test suite and never runs in production, never opens a network port, and never
handles untrusted input from a real client. That narrows the threat surface to
two things. One is what it could do to the machine running the tests. The other
is what it drags into a consumer's dependency tree. The package ships as a single
bundle that
imports nothing external, which is enforced on every build, so the second is
close to nil by construction.

This is worth saying plainly rather than behind a generic policy. A report that
smocket "accepts a malformed payload" is expected behavior, because a mock's job
is to reproduce a real server including its rough edges. A report that installing
or importing smocket can execute unexpected code, exfiltrate data, or pull in an
unexpected dependency is a real vulnerability.

## Supported versions

smocket is pre-1.0, so only the latest published release receives fixes. There
is no back-porting to earlier 0.x versions. Upgrade to the latest release.

| Version    | Supported |
| ---------- | --------- |
| latest 0.x | ✅        |
| older 0.x  | ❌        |

## Reporting a vulnerability

Please report privately rather than opening a public issue.

- Preferred. Use GitHub's private vulnerability reporting on this repository
  (the **Report a vulnerability** button under the **Security** tab). It keeps
  the discussion and any fix private until a release is ready.
- Alternatively, email dev.electrohyun@gmail.com.

Please include what you observed, how to reproduce it, and the version you saw
it on. You can expect an acknowledgement within a few days. Since this is a
single-maintainer project, a fix timeline is best-effort and will be shared on
the report.

## Out of scope

- Behavior that mirrors a quirk of real Socket.IO. smocket reproduces the
  oracle, so matching its behavior is the goal, not a flaw. If real Socket.IO
  has a vulnerability, report it to Socket.IO.
- Denial of service from a test that deliberately feeds pathological input.
- Anything requiring smocket to run outside a test or development context, which
  is not a supported use.
