import type { Finding, Rule } from "../types.js";

const TOP_LEVEL_TRAPS = new Set(["tests", "test", "docs", "doc", "examples", "scripts", "benchmarks", "tools"]);

export const pythonLayoutRule: Rule = {
  id: "python-layout",
  title: "Wheel layout problems",
  run(artifact) {
    if (artifact.kind !== "python-wheel") return [];
    const findings: Finding[] = [];
    const seen = new Set<string>();
    for (const f of artifact.files) {
      const top = f.path.split("/")[0]!;
      if (!f.path.includes("/") || seen.has(top) || !TOP_LEVEL_TRAPS.has(top)) continue;
      seen.add(top);
      findings.push({
        rule: this.id,
        severity: "medium",
        path: f.path,
        message: `Wheel installs a top-level "${top}" package into site-packages.`,
        hint: `Every package that does this collides on "${top}". Restrict package discovery (e.g. [tool.setuptools.packages.find] include = ["yourpkg*"]).`,
      });
    }
    return findings;
  },
};
