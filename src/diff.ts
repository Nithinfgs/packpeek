import { analyze } from "./analyze.js";
import type { Artifact, Config, Finding, Report } from "./types.js";

export interface DiffResult {
  old: Report;
  next: Report;
  added: Array<{ path: string; size: number }>;
  removed: Array<{ path: string; size: number }>;
  changed: Array<{ path: string; oldSize: number; newSize: number }>;
  sizeDelta: number;
  growthPct: number;
  /** Findings present in the new artifact but not the old one. */
  newFindings: Finding[];
  resolvedFindings: number;
}

const key = (f: Finding): string => `${f.rule}|${f.path ?? ""}|${f.message}`;

export function diffArtifacts(oldA: Artifact, newA: Artifact, config: Config): DiffResult {
  const old = analyze(oldA, config);
  const next = analyze(newA, config);
  const oldMap = new Map(oldA.files.map((f) => [f.path, f]));
  const newMap = new Map(newA.files.map((f) => [f.path, f]));
  const added = newA.files.filter((f) => !oldMap.has(f.path)).map((f) => ({ path: f.path, size: f.size }));
  const removed = oldA.files.filter((f) => !newMap.has(f.path)).map((f) => ({ path: f.path, size: f.size }));
  const changed: DiffResult["changed"] = [];
  for (const f of newA.files) {
    const o = oldMap.get(f.path);
    if (!o) continue;
    if (o.size !== f.size || o.sha256() !== f.sha256()) changed.push({ path: f.path, oldSize: o.size, newSize: f.size });
  }
  added.sort((a, b) => b.size - a.size);
  removed.sort((a, b) => b.size - a.size);
  changed.sort((a, b) => Math.abs(b.newSize - b.oldSize) - Math.abs(a.newSize - a.oldSize));
  const oldKeys = new Set(old.findings.map(key));
  const newKeys = new Set(next.findings.map(key));
  const sizeDelta = next.totalSize - old.totalSize;
  return {
    old,
    next,
    added,
    removed,
    changed,
    sizeDelta,
    growthPct: old.totalSize === 0 ? 0 : (sizeDelta / old.totalSize) * 100,
    newFindings: next.findings.filter((f) => !oldKeys.has(key(f))),
    resolvedFindings: old.findings.filter((f) => !newKeys.has(key(f))).length,
  };
}
