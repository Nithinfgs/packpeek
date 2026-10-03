import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG, PackpeekError, SEVERITIES, type Config, type IgnoreEntry, type Severity } from "./types.js";
import { parseSize } from "./util.js";

export const CONFIG_FILES = ["packpeek.config.json", ".packpeekrc.json"];

interface RawConfig {
  failOn?: string;
  ignore?: Array<string | { rule?: string; path?: string }>;
  maxFileSize?: string | number;
  maxTotalSize?: string | number;
}

function toBytes(v: string | number): number {
  return typeof v === "number" ? v : parseSize(v);
}

export function parseIgnore(spec: string): IgnoreEntry {
  const idx = spec.indexOf(":");
  return idx === -1 ? { rule: spec } : { rule: spec.slice(0, idx), path: spec.slice(idx + 1) };
}

export function isSeverity(s: string): s is Severity {
  return (SEVERITIES as string[]).includes(s);
}

export function loadConfig(dir: string): Config {
  const cfg: Config = { ...DEFAULT_CONFIG, ignore: [], only: [] };
  const file = CONFIG_FILES.map((f) => join(dir, f)).find((f) => existsSync(f));
  if (!file) return cfg;
  let raw: RawConfig;
  try {
    raw = JSON.parse(readFileSync(file, "utf8")) as RawConfig;
  } catch (e) {
    throw new PackpeekError(`Could not parse ${file}: ${(e as Error).message}`);
  }
  if (raw.failOn !== undefined) {
    if (raw.failOn !== "none" && !isSeverity(raw.failOn)) {
      throw new PackpeekError(`${file}: failOn must be one of none, ${SEVERITIES.join(", ")}`);
    }
    cfg.failOn = raw.failOn as Config["failOn"];
  }
  if (raw.maxFileSize !== undefined) cfg.maxFileSize = toBytes(raw.maxFileSize);
  if (raw.maxTotalSize !== undefined) cfg.maxTotalSize = toBytes(raw.maxTotalSize);
  for (const entry of raw.ignore ?? []) {
    if (typeof entry === "string") cfg.ignore.push(parseIgnore(entry));
    else if (entry.rule) cfg.ignore.push({ rule: entry.rule, path: entry.path });
  }
  return cfg;
}
