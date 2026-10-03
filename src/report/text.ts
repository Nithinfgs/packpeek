import type { DiffResult } from "../diff.js";
import { SEVERITIES, severityRank, type Finding, type Report, type Severity } from "../types.js";
import { formatBytes, pad, plural } from "../util.js";
import type { Style } from "./style.js";

const LABEL: Record<Severity, string> = { critical: "CRITICAL", high: "HIGH", medium: "MEDIUM", low: "LOW", info: "INFO" };

function paint(s: Style, sev: Severity, text: string): string {
  switch (sev) {
    case "critical":
      return s.bold(s.red(text));
    case "high":
      return s.red(text);
    case "medium":
      return s.yellow(text);
    case "low":
      return s.cyan(text);
    default:
      return s.gray(text);
  }
}

export interface TreeRow {
  name: string;
  size: number;
  count: number;
}

export function topLevelBreakdown(files: Array<{ path: string; size: number }>): TreeRow[] {
  const map = new Map<string, TreeRow>();
  for (const f of files) {
    const i = f.path.indexOf("/");
    const name = i === -1 ? "(root files)" : f.path.slice(0, i) + "/";
    const row = map.get(name) ?? { name, size: 0, count: 0 };
    row.size += f.size;
    row.count++;
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => b.size - a.size);
}

function bar(fraction: number, width: number): string {
  const filled = Math.max(fraction > 0 ? 1 : 0, Math.round(fraction * width));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function renderInside(report: Report, files: Array<{ path: string; size: number }>, s: Style, top: number): string[] {
  const out: string[] = [];
  const rows = topLevelBreakdown(files);
  const max = Math.max(1, ...rows.map((r) => r.size));
  const nameW = Math.min(24, Math.max(...rows.slice(0, 6).map((r) => r.name.length), 8));
  out.push(s.bold("WHAT'S INSIDE"));
  for (const r of rows.slice(0, 6)) {
    out.push(`  ${pad(r.name, nameW)}  ${s.cyan(bar(r.size / max, 22))}  ${pad(formatBytes(r.size), 9)} ${s.gray(plural(r.count, "file"))}`);
  }
  if (rows.length > 6) out.push(s.gray(`  … and ${rows.length - 6} more`));
  const biggest = [...files].filter((f) => f.size >= 1024).sort((a, b) => b.size - a.size).slice(0, top);
  if (biggest.length > 0) {
    out.push("");
    out.push(s.bold("LARGEST FILES"));
    for (const f of biggest) out.push(`  ${pad(formatBytes(f.size), 9)} ${f.path}`);
  }
  return out;
}

function renderFinding(f: Finding, s: Style, seenHints: Set<string>): string[] {
  const out: string[] = [];
  const badge = paint(s, f.severity, `${pad(LABEL[f.severity], 8)}`);
  const loc = f.path ? s.bold(f.path + (f.line ? `:${f.line}` : "")) : "";
  out.push(`  ${paint(s, f.severity, "●")} ${badge} ${s.magenta(pad(f.rule, 14))} ${loc}`);
  out.push(`      ${f.message}`);
  if (f.detail) out.push(`      ${s.gray(f.detail)}`);
  if (f.hint && !seenHints.has(f.hint)) {
    seenHints.add(f.hint);
    out.push(`      ${s.green("fix:")} ${s.dim(f.hint)}`);
  }
  return out;
}

export function summaryLine(findings: Finding[], s: Style): string {
  if (findings.length === 0) return s.green("✔ No findings.");
  const parts: string[] = [];
  for (const sev of [...SEVERITIES].reverse()) {
    const n = findings.filter((f) => f.severity === sev).length;
    if (n > 0) parts.push(paint(s, sev, `${n} ${sev}`));
  }
  return parts.join(s.gray(" · "));
}

export function renderText(report: Report, files: Array<{ path: string; size: number }>, s: Style, opts: { top: number; failOn: string; verbose: boolean }): string {
  const a = report.artifact;
  const id = [a.name, a.version].filter(Boolean).join("@") || a.source;
  const out: string[] = [];
  out.push("");
  out.push(`${s.bold("packpeek")}  ${s.bold(id)}  ${s.gray(`(${a.kind} · ${plural(report.fileCount, "file")} · ${formatBytes(report.totalSize)} unpacked)`)}`);
  out.push("");
  out.push(...renderInside(report, files, s, opts.top));
  out.push("");
  const shown = opts.verbose ? report.findings : report.findings.filter((f) => severityRank(f.severity) > 0);
  const hiddenInfo = report.findings.length - shown.length;
  out.push(s.bold(`FINDINGS  `) + summaryLine(shown, s));
  if (shown.length > 0) out.push("");
  const seenHints = new Set<string>();
  for (const f of shown) {
    out.push(...renderFinding(f, s, seenHints));
    out.push("");
  }
  if (hiddenInfo > 0) out.push(s.gray(`  ${plural(hiddenInfo, "info note")} hidden (use --verbose)`));
  if (report.ignored > 0) out.push(s.gray(`  ${plural(report.ignored, "finding")} suppressed by ignore rules`));
  return out.join("\n") + "\n";
}

export function renderDiffText(d: DiffResult, s: Style, opts: { top: number }): string {
  const out: string[] = [];
  const a = d.next.artifact;
  const oldId = [d.old.artifact.name, d.old.artifact.version].filter(Boolean).join("@") || d.old.artifact.source;
  const newId = [a.name, a.version].filter(Boolean).join("@") || a.source;
  out.push("");
  out.push(`${s.bold("packpeek diff")}  ${s.bold(oldId)} ${s.gray("→")} ${s.bold(newId)}`);
  out.push("");
  const sign = d.sizeDelta >= 0 ? "+" : "−";
  const delta = `${sign}${formatBytes(Math.abs(d.sizeDelta))}`;
  const pct = d.old.totalSize === 0 ? "" : ` (${d.growthPct >= 0 ? "+" : ""}${d.growthPct.toFixed(1)}%)`;
  out.push(`  size      ${formatBytes(d.old.totalSize)} → ${formatBytes(d.next.totalSize)}   ${d.sizeDelta > 0 ? s.yellow(delta + pct) : s.green(delta + pct)}`);
  out.push(`  files     ${d.old.fileCount} → ${d.next.fileCount}   ${s.green(`+${d.added.length}`)} ${s.red(`−${d.removed.length}`)} ${s.gray(`~${d.changed.length} changed`)}`);
  if (d.added.length > 0) {
    out.push("");
    out.push(s.bold("NEW FILES (largest first)"));
    for (const f of d.added.slice(0, opts.top)) out.push(`  ${s.green("+")} ${pad(formatBytes(f.size), 9)} ${f.path}`);
    if (d.added.length > opts.top) out.push(s.gray(`    … and ${d.added.length - opts.top} more`));
  }
  if (d.removed.length > 0) {
    out.push("");
    out.push(s.bold("REMOVED FILES"));
    for (const f of d.removed.slice(0, opts.top)) out.push(`  ${s.red("−")} ${pad(formatBytes(f.size), 9)} ${f.path}`);
    if (d.removed.length > opts.top) out.push(s.gray(`    … and ${d.removed.length - opts.top} more`));
  }
  out.push("");
  out.push(s.bold("NEW FINDINGS  ") + summaryLine(d.newFindings, s) + s.gray(d.resolvedFindings > 0 ? `   (${d.resolvedFindings} resolved)` : ""));
  if (d.newFindings.length > 0) out.push("");
  const seenHints = new Set<string>();
  for (const f of d.newFindings.filter((x) => severityRank(x.severity) > 0)) {
    out.push(...renderFinding(f, s, seenHints));
    out.push("");
  }
  return out.join("\n") + "\n";
}
