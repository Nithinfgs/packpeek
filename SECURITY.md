# Security policy

## Reporting a vulnerability

Please report privately via GitHub: <https://github.com/Nithinfgs/packpeek/security/advisories/new>. Do not open a public issue for a vulnerability.

You should get an acknowledgement within a few days. This is a small, volunteer-maintained project, so there is no formal SLA, but security reports take priority.

## Scope

packpeek reads archives and directories that may come from untrusted sources. In scope:

- Crashes, hangs or unbounded memory use triggered by a crafted archive (zip bombs, malformed tar headers)
- Path or symlink handling that makes it read files outside the target
- Secret values appearing unredacted in any output format
- Command execution beyond the documented `npm pack` invocation (`--ignore-scripts` is passed for dry runs; `--pack` intentionally runs `prepack`/`prepare` and says so)

Out of scope: false negatives in secret detection (these are documented limits; please file a normal issue), and findings about the demo's generated package.

## Design notes

- No runtime dependencies, so no transitive supply chain.
- Archives are parsed in memory and never extracted to disk; entry paths are used only as labels.
- Archive size is capped at 1 GB; files over 20 MB are not content-scanned.
