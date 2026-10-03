export type Severity = "info" | "low" | "medium" | "high" | "critical";

export const SEVERITIES: Severity[] = ["info", "low", "medium", "high", "critical"];

export function severityRank(s: Severity): number {
  return SEVERITIES.indexOf(s);
}

export type ArtifactKind = "npm" | "python-wheel" | "python-sdist" | "crate" | "tree";

export interface FileEntry {
  /** Path inside the artifact, forward slashes, no leading "./" or archive root. */
  path: string;
  size: number;
  /** Raw bytes. Memoized; may be expensive for compressed archives. */
  bytes(): Buffer;
  /** UTF-8 text, or undefined when the file looks binary or is too large to scan. */
  text(): string | undefined;
  /** sha256 hex digest of the contents. Memoized. */
  sha256(): string;
}

export interface Artifact {
  kind: ArtifactKind;
  /** What the user pointed us at: a path, a spec, or "." */
  source: string;
  name?: string;
  version?: string;
  files: FileEntry[];
}

export interface Finding {
  rule: string;
  severity: Severity;
  message: string;
  path?: string;
  line?: number;
  /** Extra context, already redacted. */
  detail?: string;
  /** How to fix it. */
  hint?: string;
}

export interface Rule {
  id: string;
  title: string;
  run(artifact: Artifact, config: Config): Finding[];
}

export interface IgnoreEntry {
  rule: string;
  /** Glob matched against the file path inside the artifact. Omit to ignore the rule everywhere. */
  path?: string;
}

export interface Config {
  failOn: Severity | "none";
  ignore: IgnoreEntry[];
  /** Bytes. Files above this get a size finding. */
  maxFileSize: number;
  /** Bytes. Total unpacked size above this gets a finding. 0 disables. */
  maxTotalSize: number;
  /** Files larger than this are not content-scanned. */
  maxScanSize: number;
  /** Rule ids to run. Empty means all. */
  only: string[];
}

export const DEFAULT_CONFIG: Config = {
  failOn: "high",
  ignore: [],
  maxFileSize: 1024 * 1024,
  maxTotalSize: 0,
  maxScanSize: 20 * 1024 * 1024,
  only: [],
};

export interface Report {
  artifact: Pick<Artifact, "kind" | "source" | "name" | "version">;
  fileCount: number;
  totalSize: number;
  findings: Finding[];
  ignored: number;
}

export class PackpeekError extends Error {}
