import type { Artifact, Finding, Rule } from "../types.js";

interface Manifest {
  main?: string;
  module?: string;
  types?: string;
  typings?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
  files?: unknown;
  scripts?: Record<string, string>;
  private?: boolean;
}

function exportTargets(v: unknown, out: string[]): void {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => exportTargets(x, out));
  else if (v && typeof v === "object") Object.values(v as Record<string, unknown>).forEach((x) => exportTargets(x, out));
}

function norm(p: string): string {
  return p.replace(/^\.\//, "").replace(/\/$/, "");
}

export const npmManifestRule: Rule = {
  id: "npm-manifest",
  title: "package.json vs. what actually ships",
  run(artifact: Artifact) {
    if (artifact.kind !== "npm") return [];
    const pkgFile = artifact.files.find((f) => f.path === "package.json");
    if (!pkgFile) return [];
    let pkg: Manifest;
    try {
      pkg = JSON.parse(pkgFile.text() ?? "{}") as Manifest;
    } catch {
      return [];
    }
    const findings: Finding[] = [];
    const paths = new Set(artifact.files.map((f) => f.path));
    const hasPath = (p: string): boolean => {
      const n = norm(p);
      if (n.includes("*")) return true; // wildcard subpath patterns: can't verify cheaply
      return paths.has(n) || [...paths].some((x) => x.startsWith(n + "/")) || paths.has(n + ".js") || paths.has(n + "/index.js");
    };

    const entries: Array<[string, string]> = [];
    for (const key of ["main", "module", "types", "typings"] as const) {
      const v = pkg[key];
      if (typeof v === "string") entries.push([key, v]);
    }
    if (typeof pkg.bin === "string") entries.push(["bin", pkg.bin]);
    else if (pkg.bin) for (const [k, v] of Object.entries(pkg.bin)) entries.push([`bin.${k}`, v]);
    const ex: string[] = [];
    exportTargets(pkg.exports, ex);
    for (const t of ex) if (t.startsWith("./")) entries.push(["exports", t]);

    for (const [field, target] of entries) {
      if (hasPath(target)) continue;
      findings.push({
        rule: this.id,
        severity: "high",
        path: "package.json",
        message: `"${field}" points to ${target}, which is not in the package. Installing it will break.`,
        hint: "Did the build run before packing? Or is the output directory missing from the files allowlist?",
      });
    }

    if (pkg.files === undefined && !paths.has(".npmignore")) {
      findings.push({
        rule: this.id,
        severity: "medium",
        path: "package.json",
        message: 'No "files" allowlist and no .npmignore: everything not git-ignored ships.',
        hint: 'Add a "files" array so new files are excluded by default instead of included by default.',
      });
    }

    const lifecycle = ["preinstall", "install", "postinstall"].filter((s) => pkg.scripts?.[s]);
    for (const s of lifecycle) {
      findings.push({
        rule: this.id,
        severity: "info",
        path: "package.json",
        message: `Defines a "${s}" script that runs on every consumer's machine: ${pkg.scripts![s]}`,
      });
    }
    if (pkg.private === true) {
      findings.push({ rule: this.id, severity: "info", path: "package.json", message: 'package.json has "private": true; npm publish will refuse it.' });
    }
    return findings;
  },
};
