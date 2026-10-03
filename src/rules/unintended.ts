import type { Finding, Rule } from "../types.js";
import { basename, formatBytes } from "../util.js";

interface Category {
  id: string;
  label: string;
  test: (path: string, base: string) => boolean;
  /** Which artifact kinds this makes sense for. Undefined = all except trees. */
  kinds?: string[];
}

const CATEGORIES: Category[] = [
  { id: "tests", label: "test files", test: (p, b) => /(?:^|\/)(?:tests?|__tests__|spec|__mocks__)\//.test(p) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(b) || /^test_.*\.py$/.test(b) || /_test\.(?:py|go)$/.test(b) },
  { id: "fixtures", label: "fixtures and snapshots", test: (p) => /(?:^|\/)(?:fixtures?|__snapshots__|__fixtures__)\//.test(p) },
  { id: "ci", label: "CI and repo-meta files", test: (p, b) => /^\.(?:github|circleci|gitlab|husky)\//.test(p) || [".travis.yml", ".gitlab-ci.yml", "azure-pipelines.yml", "appveyor.yml", "renovate.json", ".gitattributes", "CODEOWNERS"].includes(b) },
  { id: "tooling", label: "lint/format/editor configs", test: (_p, b) => /^\.(?:eslintrc|prettierrc|babelrc|editorconfig|nvmrc|swcrc)/.test(b) || /^(?:eslint|prettier|jest|vitest|babel|rollup|webpack|vite|tsup)\.config\./.test(b) || /^\.idea\/|^\.vscode\//.test(_p) },
  { id: "coverage", label: "coverage output", test: (p) => /(?:^|\/)(?:coverage|\.nyc_output|htmlcov)\//.test(p) || basename(p) === ".coverage" },
  { id: "caches", label: "cache and build leftovers", test: (p, b) => /(?:^|\/)(?:__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.tox|\.cache|\.turbo)\//.test(p) || /\.(?:pyc|pyo|tsbuildinfo)$/.test(b) },
  { id: "docs", label: "docs and examples", test: (p) => /^(?:docs?|examples?|demo|website)\//.test(p), kinds: ["npm", "python-wheel", "crate"] },
  { id: "nested-deps", label: "vendored node_modules", test: (p) => /(?:^|\/)node_modules\//.test(p), kinds: ["npm", "python-wheel", "python-sdist", "crate"] },
];

export const unintendedRule: Rule = {
  id: "unintended",
  title: "Files that probably were not meant to ship",
  run(artifact) {
    if (artifact.kind === "tree") return [];
    const findings: Finding[] = [];
    for (const cat of CATEGORIES) {
      if (cat.kinds && !cat.kinds.includes(artifact.kind)) continue;
      // Source distributions legitimately contain tests, docs and CI config.
      if (artifact.kind === "python-sdist" && ["tests", "fixtures", "ci", "tooling", "docs"].includes(cat.id)) continue;
      // Crates routinely ship tests and examples.
      if (artifact.kind === "crate" && ["tests", "fixtures", "docs"].includes(cat.id)) continue;
      const hits = artifact.files.filter((f) => cat.test(f.path, basename(f.path)));
      if (hits.length === 0) continue;
      const bytes = hits.reduce((n, f) => n + f.size, 0);
      const examples = hits.slice(0, 3).map((f) => f.path).join(", ");
      findings.push({
        rule: this.id,
        severity: cat.id === "nested-deps" || cat.id === "coverage" ? "medium" : "low",
        path: hits[0]!.path,
        message: `${hits.length} ${cat.label} (${formatBytes(bytes)}).`,
        detail: hits.length === 1 ? undefined : hits.length > 3 ? `${examples}, …` : examples,
        hint: artifact.kind === "npm" ? 'Add a "files" allowlist to package.json so only intended output ships.' : "Exclude these via your build backend config or MANIFEST.in.",
      });
    }
    return findings;
  },
};
