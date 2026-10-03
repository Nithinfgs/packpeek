import { matchGlob } from "./glob.js";
import { RULES } from "./rules/index.js";
import { PackpeekError, severityRank, type Artifact, type Config, type Finding, type Report } from "./types.js";

export function isIgnored(f: Finding, config: Config): boolean {
  return config.ignore.some((i) => i.rule === f.rule && (i.path === undefined || (f.path !== undefined && matchGlob(i.path, f.path))));
}

export function analyze(artifact: Artifact, config: Config): Report {
  const known = new Set(RULES.map((r) => r.id));
  for (const id of config.only) if (!known.has(id)) throw new PackpeekError(`Unknown rule "${id}". Run \`packpeek rules\` to list them.`);
  const active = RULES.filter((r) => config.only.length === 0 || config.only.includes(r.id));
  const all: Finding[] = [];
  for (const rule of active) all.push(...rule.run(artifact, config));
  const kept = all.filter((f) => !isIgnored(f, config));
  kept.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      a.rule.localeCompare(b.rule) ||
      (a.path ?? "").localeCompare(b.path ?? ""),
  );
  return {
    artifact: { kind: artifact.kind, source: artifact.source, name: artifact.name, version: artifact.version },
    fileCount: artifact.files.length,
    totalSize: artifact.files.reduce((n, f) => n + f.size, 0),
    findings: kept,
    ignored: all.length - kept.length,
  };
}

export function exceedsThreshold(report: Report, config: Pick<Config, "failOn">): boolean {
  if (config.failOn === "none") return false;
  const min = severityRank(config.failOn);
  return report.findings.some((f) => severityRank(f.severity) >= min);
}
