# Changelog

## Unreleased

## 0.1.0

First release.

- Inspect npm projects (via `npm pack --dry-run --ignore-scripts`), npm tarballs, Python wheels and sdists, Rust crates, zip files and plain directories
- Eight checks: `sourcemap`, `secret`, `sensitive-file`, `local-path`, `npm-manifest`, `python-layout`, `unintended`, `size`
- `packpeek diff` between any two artifacts (including `npm:<version>`): new/removed/changed files, size growth, new findings only, `--max-growth`
- Output formats: text, JSON, GitHub Actions annotations, Markdown
- `packpeek.config.json`, `--ignore rule[:glob]`, `--rule`, `--fail-on`
- `packpeek demo`: inspects a generated, deliberately leaky package
- Zero runtime dependencies; secrets are always redacted in output
