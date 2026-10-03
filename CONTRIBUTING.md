# Contributing

Thanks for looking. packpeek is small on purpose, so contributing is quick.

## Setup

```bash
git clone https://github.com/Nithinfgs/packpeek && cd packpeek
npm ci
npm test          # builds, then runs the node:test suite
npm run lint
npm run self-check
```

Node 20 or newer. There are **no runtime dependencies** and I would like to keep it that way: parsing tar and zip is small enough to own.

## What makes a good contribution

- **A false positive or missed leak with a minimal reproduction.** Use the issue template. This is the most valuable thing you can send.
- **A new rule** for a real publishing mistake. Link an incident or a package that did it. See "Adding a rule" in [docs/rules.md](docs/rules.md).
- **A new artifact type** (Docker `save` tarballs, Maven, NuGet). Loaders live in `src/loaders/`.

## Ground rules

- Every rule needs a test that proves it fires **and** a test that proves a plausible look-alike does not.
- Never put real secrets in tests. Build token-shaped strings at runtime (see `FAKE` in `test/helpers.ts`) so the repo stays clean of secret-looking literals.
- Never print a secret value. Use `redact()`.
- Keep output deterministic and offline. The only network access allowed is the explicit `npm:` spec in `diff`.
- Match the existing style; `npm run lint` is the arbiter.

## Pull requests

Small and focused is better than large and thorough. Update `CHANGELOG.md` under "Unreleased". CI runs lint, type-check, tests on Linux/macOS/Windows, and packs the repo and runs packpeek on its own tarball.
