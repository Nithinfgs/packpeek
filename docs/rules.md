# Rules

Every rule is a pure function over an artifact (a virtual list of files). Severities are `info < low < medium < high < critical`. The default `--fail-on` is `high`.

Run `packpeek rules` for the list; use `--rule <id>` to run one, `--ignore <rule[:glob]>` to suppress.

## `sourcemap`

| Finding | Severity |
|---|---|
| `.map` file embeds original source (`sourcesContent`) for project files | **high**, or **low** if the package declares an OSI-style license (MIT, ISC, BSD, Apache-2.0, MPL-2.0, GPL…) or a wheel/sdist carries an `OSI Approved` classifier |
| Inline base64 `sourceMappingURL` that embeds source | high |
| `sourceMappingURL` pointing at an `http(s)://` host | medium |
| Maps that list original paths but embed no source | low (collapsed into one finding) |

Sources under `node_modules/` are ignored when deciding whether a map exposes *your* code.

**Why license-aware:** open-source libraries often ship maps deliberately, so a "high" on every one would be noise. A package with no license, or a proprietary one, is where embedded source is most likely a mistake.

## `secret`

Vendor-anchored patterns: AWS access key id and secret, GitHub tokens (`ghp_`, `github_pat_`, …), npm tokens, PyPI tokens, Slack, Stripe live keys, Google API keys, OpenAI and Anthropic keys, private key blocks, JWTs. Plus a generic "hard-coded credential" check restricted to config-like files (`.env*`, `.json`, `.yml`, `.ini`, `.toml`, …) that skips obvious placeholders (`your-…`, `changeme`, `${VAR}`, `process.env`, …).

Skipped: lockfiles, binary files, files over `maxScanSize` (20 MB), AWS documentation example keys.

Output shows the first four characters and the length, never the value.

Not an entropy scanner. See the limits in the README.

## `sensitive-file`

By path: `.env` (not `.env.example` / `.sample` / `.template`), `.npmrc` (critical when it holds a literal auth token, low if it only references `${VAR}`), `.pypirc`, `.netrc`, `.htpasswd`, SSH keys, `*.pem` / `*.key` / `*.p12` / `*.jks`, `.git/`, `.aws/`, `.ssh/`, `.kube/`, `.docker/config.json`, Terraform state, `credentials.json`, service-account JSON, databases, dumps, logs, OS metadata.

## `local-path`

Absolute paths such as `/Users/<name>/…`, `/home/<name>/…`, `C:\Users\<name>\…`. Generic CI and placeholder users (`runner`, `node`, `user`, `ubuntu`, `<name>`, …) are ignored. One finding per file with a count and a sample.

Severity is **medium** in generated or config files (`.js`, `.map`, `.json`, `.html`, `.env`, …) and **low** elsewhere, because docstrings and prose frequently contain example paths.

## `npm-manifest` (npm only)

| Finding | Severity |
|---|---|
| `main`, `module`, `types`, `typings`, `bin`, or an `exports` target that is not in the package | **high** |
| No `files` allowlist and no `.npmignore` | medium |
| `preinstall` / `install` / `postinstall` script | info (shown with `--verbose`) |
| `"private": true` | info |

Wildcard `exports` subpaths are assumed to resolve.

## `python-layout` (wheels only)

A wheel that installs a top-level `tests`, `test`, `docs`, `examples`, `scripts`, `benchmarks` or `tools` package. Every other package doing the same collides with it in `site-packages`. Medium.

## `unintended`

Groups of files that usually should not ship, one finding per group with count and total size: tests, fixtures and snapshots, CI and repo-meta files, lint/format/editor configs, coverage output, caches and bytecode, docs and examples, vendored `node_modules`.

sdists and crates legitimately contain tests, docs and CI config, so those groups are skipped for them. Plain directory targets skip this rule entirely. Coverage output and vendored `node_modules` are **medium**, the rest **low**.

## `size`

Files above `--max-file-size` (default 1 MB): low, medium above 5 MB, high above 25 MB. Identical files of at least 10 KB. Optional total-size budget (`--max-total-size`).

## Adding a rule

1. Create `src/rules/<name>.ts` exporting a `Rule` (`id`, `title`, `run(artifact, config) => Finding[]`).
2. Register it in `src/rules/index.ts`.
3. Add tests in `test/rules.test.ts` including at least one **plausible false positive** that must stay quiet.
4. Document it here.
