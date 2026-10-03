import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename as pathBasename, join, relative, resolve, sep } from "node:path";
import { PackpeekError, type Artifact, type ArtifactKind, type Config, type FileEntry } from "../types.js";
import { makeEntry } from "../util.js";
import { parseTgz, type RawEntry } from "./tar.js";
import { parseZip } from "./zip.js";

const MAX_ARCHIVE_BYTES = 1024 ** 3;
const SKIP_DIRS_IN_TREE = new Set([".git"]);

export interface LoadOptions {
  cwd: string;
  /** For npm projects: run `npm pack` for real (runs prepack/prepare scripts) instead of a dry run. */
  pack: boolean;
  config: Config;
}

function npmBin(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runNpm(args: string[], cwd: string): string {
  const r = spawnSync(npmBin(), args, { cwd, encoding: "utf8", shell: process.platform === "win32", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new PackpeekError(`Could not run npm: ${r.error.message}`);
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || "").trim().split("\n").slice(-6).join("\n");
    throw new PackpeekError(`npm ${args[0]} failed:\n${msg}`);
  }
  return r.stdout;
}

function toEntries(raw: RawEntry[], config: Config): FileEntry[] {
  return raw.map((r) => makeEntry(r.path, r.size, r.data, config.maxScanSize));
}

/** Strip the single archive root dir ("package/", "name-1.0.0/") when every entry shares it. */
function stripRoot(raw: RawEntry[]): RawEntry[] {
  if (raw.length === 0) return raw;
  const first = raw[0]!.path.split("/")[0]!;
  if (!raw.every((r) => r.path.startsWith(first + "/"))) return raw;
  return raw.map((r) => ({ ...r, path: r.path.slice(first.length + 1) }));
}

function readText(entries: FileEntry[], path: string): string | undefined {
  return entries.find((e) => e.path === path)?.text();
}

function npmMeta(entries: FileEntry[]): { name?: string; version?: string } {
  const text = readText(entries, "package.json");
  if (!text) return {};
  try {
    const pkg = JSON.parse(text) as { name?: string; version?: string };
    return { name: pkg.name, version: pkg.version };
  } catch {
    return {};
  }
}

function fromTarball(file: string, config: Config): Artifact {
  const st = statSync(file);
  if (st.size > MAX_ARCHIVE_BYTES) throw new PackpeekError(`Archive is larger than ${MAX_ARCHIVE_BYTES / 1024 ** 3} GB; refusing to load it into memory.`);
  const raw = stripRoot(parseTgz(readFileSync(file)));
  const files = toEntries(raw, config);
  const paths = new Set(files.map((f) => f.path));
  let kind: ArtifactKind = "npm";
  let meta: { name?: string; version?: string } = {};
  if (paths.has("package.json")) {
    meta = npmMeta(files);
  } else if (paths.has("Cargo.toml") || file.endsWith(".crate")) {
    kind = "crate";
    const toml = readText(files, "Cargo.toml") ?? "";
    meta = {
      name: /^\s*name\s*=\s*"([^"]+)"/m.exec(toml)?.[1],
      version: /^\s*version\s*=\s*"([^"]+)"/m.exec(toml)?.[1],
    };
  } else if (paths.has("PKG-INFO")) {
    kind = "python-sdist";
    const info = readText(files, "PKG-INFO") ?? "";
    meta = { name: /^Name:\s*(.+)$/m.exec(info)?.[1]?.trim(), version: /^Version:\s*(.+)$/m.exec(info)?.[1]?.trim() };
  }
  return { kind, source: file, ...meta, files };
}

function fromWheel(file: string, config: Config): Artifact {
  const st = statSync(file);
  if (st.size > MAX_ARCHIVE_BYTES) throw new PackpeekError(`Archive is larger than ${MAX_ARCHIVE_BYTES / 1024 ** 3} GB; refusing to load it into memory.`);
  const files = toEntries(parseZip(readFileSync(file)), config);
  const m = /^([A-Za-z0-9_.]+)-([A-Za-z0-9_.!+]+?)-/.exec(pathBasename(file));
  return { kind: "python-wheel", source: file, name: m?.[1], version: m?.[2], files };
}

function walk(root: string, dir: string, out: string[]): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS_IN_TREE.has(ent.name) && dir === root) continue;
      walk(root, join(dir, ent.name), out);
    } else if (ent.isFile()) {
      out.push(join(dir, ent.name));
    }
  }
}

function fromTree(dir: string, config: Config): Artifact {
  const abs: string[] = [];
  walk(dir, dir, abs);
  const files = abs.map((p) => {
    const rel = relative(dir, p).split(sep).join("/");
    return makeEntry(rel, statSync(p).size, () => readFileSync(p), config.maxScanSize);
  });
  return { kind: "tree", source: dir, files };
}

interface NpmPackJson {
  name?: string;
  version?: string;
  filename?: string;
  files?: Array<{ path: string; size: number }>;
}

function parseNpmJson(stdout: string): NpmPackJson {
  const start = stdout.indexOf("[");
  try {
    return (JSON.parse(stdout.slice(start)) as NpmPackJson[])[0] ?? {};
  } catch {
    throw new PackpeekError("Could not parse `npm pack --json` output.");
  }
}

function fromNpmProject(dir: string, opts: LoadOptions): Artifact {
  if (opts.pack) {
    const tmp = mkdtempSync(join(tmpdir(), "packpeek-"));
    try {
      const info = parseNpmJson(runNpm(["pack", "--json", "--pack-destination", tmp], dir));
      if (!info.filename) throw new PackpeekError("npm pack did not report a filename.");
      return { ...fromTarball(join(tmp, info.filename), opts.config), source: dir };
    } finally {
      // fromTarball has already loaded the archive into memory, so the temp file can go.
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  const info = parseNpmJson(runNpm(["pack", "--dry-run", "--json", "--ignore-scripts"], dir));
  const files = (info.files ?? []).map((f) =>
    makeEntry(f.path, f.size, () => readFileSync(join(dir, f.path)), opts.config.maxScanSize),
  );
  return { kind: "npm", source: dir, name: info.name, version: info.version, files };
}

function fromPythonDist(dir: string, opts: LoadOptions): Artifact {
  const dist = join(dir, "dist");
  const candidates = readdirSync(dist)
    .filter((f) => f.endsWith(".whl") || f.endsWith(".tar.gz"))
    .map((f) => join(dist, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (candidates.length === 0) throw new PackpeekError("No .whl or .tar.gz found in ./dist. Build first (python -m build).");
  return fromFile(candidates[0]!, opts);
}

function fromFile(file: string, opts: LoadOptions): Artifact {
  if (/\.(tgz|tar\.gz|crate)$/i.test(file)) return fromTarball(file, opts.config);
  if (/\.(whl|zip)$/i.test(file)) return fromWheel(file, opts.config);
  throw new PackpeekError(`Don't know how to read ${file}. Supported: .tgz, .tar.gz, .crate, .whl, .zip, or a directory.`);
}

/** `npm:pkg@1.2.3`, `npm:pkg`, or `npm:1.2.3` (name taken from the current package.json). */
function fromNpmSpec(spec: string, opts: LoadOptions): Artifact {
  let target = spec.slice(4);
  if (/^\d/.test(target) || target === "latest") {
    const pkgPath = join(opts.cwd, "package.json");
    if (!existsSync(pkgPath)) throw new PackpeekError(`"${spec}" needs a package name: use npm:<name>@<version> or run inside a package.`);
    const name = (JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string }).name;
    if (!name) throw new PackpeekError("package.json has no name.");
    target = `${name}@${target}`;
  }
  const tmp = mkdtempSync(join(tmpdir(), "packpeek-"));
  try {
    const info = parseNpmJson(runNpm(["pack", target, "--json", "--pack-destination", tmp], opts.cwd));
    if (!info.filename) throw new PackpeekError(`npm could not fetch ${target}.`);
    return { ...fromTarball(join(tmp, info.filename), opts.config), source: spec };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function loadArtifact(target: string | undefined, opts: LoadOptions): Artifact {
  const t = target ?? ".";
  if (t.startsWith("npm:")) return fromNpmSpec(t, opts);
  const abs = resolve(opts.cwd, t);
  if (!existsSync(abs)) throw new PackpeekError(`Not found: ${t}`);
  const st = statSync(abs);
  if (st.isFile()) return fromFile(abs, opts);
  if (existsSync(join(abs, "package.json"))) return fromNpmProject(abs, opts);
  if (existsSync(join(abs, "dist")) && (existsSync(join(abs, "pyproject.toml")) || existsSync(join(abs, "setup.py")))) {
    return fromPythonDist(abs, opts);
  }
  return fromTree(abs, opts.config);
}

export function npmAvailable(): boolean {
  try {
    execFileSync(npmBin(), ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
    return true;
  } catch {
    return false;
  }
}
