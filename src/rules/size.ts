import type { Finding, Rule } from "../types.js";
import { formatBytes } from "../util.js";

export const sizeRule: Rule = {
  id: "size",
  title: "Oversized and duplicated files",
  run(artifact, config) {
    const findings: Finding[] = [];
    for (const f of artifact.files) {
      if (f.size <= config.maxFileSize) continue;
      const severity = f.size > 25 * 1024 * 1024 ? "high" : f.size > 5 * 1024 * 1024 ? "medium" : "low";
      findings.push({
        rule: this.id,
        severity,
        path: f.path,
        message: `Large file: ${formatBytes(f.size)} (limit ${formatBytes(config.maxFileSize)}).`,
        hint: "Is this expected? A single unexpected large file is the classic sign of a stray bundle, map or data dump.",
      });
    }
    const total = artifact.files.reduce((n, f) => n + f.size, 0);
    if (config.maxTotalSize > 0 && total > config.maxTotalSize) {
      findings.push({
        rule: this.id,
        severity: "medium",
        message: `Total unpacked size ${formatBytes(total)} exceeds the configured limit of ${formatBytes(config.maxTotalSize)}.`,
      });
    }
    // Duplicate content (same hash, >= 10 KB).
    const byHash = new Map<string, string[]>();
    for (const f of artifact.files) {
      if (f.size < 10 * 1024 || f.size > config.maxScanSize) continue;
      const h = f.sha256();
      const list = byHash.get(h);
      if (list) list.push(f.path);
      else byHash.set(h, [f.path]);
    }
    for (const paths of byHash.values()) {
      if (paths.length < 2) continue;
      const size = artifact.files.find((f) => f.path === paths[0])!.size;
      findings.push({
        rule: this.id,
        severity: "low",
        path: paths[1],
        message: `${paths.length} identical copies of a ${formatBytes(size)} file.`,
        detail: paths.slice(0, 3).join(", "),
      });
    }
    return findings;
  },
};
