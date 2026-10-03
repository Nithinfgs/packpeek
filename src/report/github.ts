import { severityRank, type Report } from "../types.js";

function esc(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** GitHub Actions workflow commands: findings show up as annotations on the run. */
export function renderGithub(report: Report): string {
  const lines: string[] = [];
  for (const f of report.findings) {
    if (severityRank(f.severity) === 0) continue;
    const level = severityRank(f.severity) >= severityRank("high") ? "error" : severityRank(f.severity) >= severityRank("medium") ? "warning" : "notice";
    const props = [`title=${esc(`packpeek ${f.rule} (${f.severity})`)}`];
    if (f.path) props.unshift(`file=${esc(f.path)}`);
    if (f.line) props.push(`line=${f.line}`);
    lines.push(`::${level} ${props.join(",")}::${esc(f.message + (f.detail ? ` ${f.detail}` : ""))}`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}
