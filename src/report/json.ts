import type { DiffResult } from "../diff.js";
import type { Report } from "../types.js";

export function renderJson(report: Report): string {
  return JSON.stringify(report, null, 2) + "\n";
}

export function renderDiffJson(d: DiffResult): string {
  return (
    JSON.stringify(
      {
        old: d.old.artifact,
        new: d.next.artifact,
        sizeDelta: d.sizeDelta,
        growthPct: Number(d.growthPct.toFixed(2)),
        added: d.added,
        removed: d.removed,
        changed: d.changed,
        newFindings: d.newFindings,
        resolvedFindings: d.resolvedFindings,
      },
      null,
      2,
    ) + "\n"
  );
}
