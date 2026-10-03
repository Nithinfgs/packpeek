import type { DiffResult } from "../diff.js";
import { severityRank, type Report } from "../types.js";
import { formatBytes } from "../util.js";

const ICON = { critical: "🟥", high: "🟥", medium: "🟧", low: "🟦", info: "⬜" } as const;

function table(findings: Report["findings"]): string[] {
  const rows = findings.filter((f) => severityRank(f.severity) > 0);
  if (rows.length === 0) return ["No findings. ✅"];
  const out = ["| | Severity | Rule | File | Message |", "|---|---|---|---|---|"];
  for (const f of rows) {
    const msg = (f.message + (f.detail ? ` \`${f.detail.replace(/`/g, "'")}\`` : "")).replace(/\|/g, "\\|");
    out.push(`| ${ICON[f.severity]} | ${f.severity} | \`${f.rule}\` | ${f.path ? `\`${f.path}${f.line ? `:${f.line}` : ""}\`` : ""} | ${msg} |`);
  }
  return out;
}

/** Markdown for PR comments / job summaries. */
export function renderMarkdown(report: Report): string {
  const a = report.artifact;
  const id = [a.name, a.version].filter(Boolean).join("@") || a.source;
  return [`### packpeek: \`${id}\``, "", `${report.fileCount} files · ${formatBytes(report.totalSize)} unpacked`, "", ...table(report.findings), ""].join("\n");
}

export function renderDiffMarkdown(d: DiffResult): string {
  const sign = d.sizeDelta >= 0 ? "+" : "−";
  return [
    `### packpeek diff`,
    "",
    `Size ${formatBytes(d.old.totalSize)} → ${formatBytes(d.next.totalSize)} (${sign}${formatBytes(Math.abs(d.sizeDelta))}) · +${d.added.length} / −${d.removed.length} files`,
    "",
    ...(d.added.length ? ["**New files**", "", ...d.added.slice(0, 10).map((f) => `- \`${f.path}\` (${formatBytes(f.size)})`), ""] : []),
    "**New findings**",
    "",
    ...table(d.newFindings),
    "",
  ].join("\n");
}
