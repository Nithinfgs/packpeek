#!/usr/bin/env node
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { analyze, exceedsThreshold } from "./analyze.js";
import { isSeverity, loadConfig, parseIgnore } from "./config.js";
import { createLeakyProject } from "./demo.js";
import { diffArtifacts } from "./diff.js";
import { loadArtifact } from "./loaders/index.js";
import { renderDiffJson, renderJson } from "./report/json.js";
import { renderGithub } from "./report/github.js";
import { renderDiffMarkdown, renderMarkdown } from "./report/markdown.js";
import { colorEnabled, makeStyle } from "./report/style.js";
import { renderDiffText, renderText } from "./report/text.js";
import { RULES } from "./rules/index.js";
import { PackpeekError, SEVERITIES, severityRank, type Config } from "./types.js";
import { parseSize } from "./util.js";

const HELP = `packpeek: see what you are about to publish.

Usage
  packpeek [target] [options]          Inspect an artifact (default: current directory)
  packpeek diff <old> [new] [options]  Compare two artifacts; report new files and new findings
  packpeek demo                        Inspect a deliberately leaky sample package
  packpeek rules                       List the checks

Targets
  .                  an npm project (uses \`npm pack --dry-run\`), a Python project with ./dist, or any directory
  pkg.tgz            npm tarball, sdist (.tar.gz) or Rust .crate
  pkg.whl / .zip     Python wheel or zip
  npm:name@1.2.3     a version fetched from the npm registry (diff old side; needs network)
  npm:1.2.3          same, using the name from the local package.json

Options
  --fail-on <level>        Exit 1 at this severity or above: info|low|medium|high|critical|none (default: high)
  --format <fmt>           text (default) | json | github | markdown
  --json                   Shortcut for --format json
  --ignore <rule[:glob]>   Suppress a rule, optionally only for matching paths. Repeatable
  --rule <id>              Run only this rule. Repeatable
  --max-file-size <size>   Flag files above this size (default 1mb). e.g. 500kb, 2mb
  --max-total-size <size>  Flag artifacts whose unpacked size exceeds this
  --max-growth <percent>   (diff) Exit 1 if unpacked size grew more than this percent
  --pack                   For npm projects: run a real \`npm pack\` (executes prepack/prepare scripts)
  --top <n>                How many large/new files to list (default 5)
  --verbose                Also show info-level notes
  --no-color               Disable colors (NO_COLOR is respected)
  -v, --version            Print version
  -h, --help               Show this help

Config: packpeek.config.json in the working directory. See https://github.com/Nithinfgs/packpeek#configuration
Exit codes: 0 ok · 1 findings at or above --fail-on · 2 error`;

function version(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../../package.json", "../package.json"]) {
    try {
      return (JSON.parse(readFileSync(join(here, rel), "utf8")) as { version: string }).version;
    } catch {
      // try next
    }
  }
  return "unknown";
}

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "fail-on": { type: "string" },
      format: { type: "string" },
      json: { type: "boolean" },
      ignore: { type: "string", multiple: true },
      rule: { type: "string", multiple: true },
      "max-file-size": { type: "string" },
      "max-total-size": { type: "string" },
      "max-growth": { type: "string" },
      pack: { type: "boolean" },
      top: { type: "string" },
      verbose: { type: "boolean" },
      "no-color": { type: "boolean" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    console.log(version());
    return 0;
  }

  const cwd = process.cwd();
  const config: Config = loadConfig(cwd);
  if (values["fail-on"] !== undefined) {
    const v = values["fail-on"];
    if (v !== "none" && !isSeverity(v)) throw new PackpeekError(`--fail-on must be one of none, ${SEVERITIES.join(", ")}`);
    config.failOn = v as Config["failOn"];
  }
  for (const spec of values.ignore ?? []) config.ignore.push(parseIgnore(spec));
  if (values.rule) config.only = values.rule;
  if (values["max-file-size"]) config.maxFileSize = parseSize(values["max-file-size"]);
  if (values["max-total-size"]) config.maxTotalSize = parseSize(values["max-total-size"]);

  const format = values.json ? "json" : (values.format ?? "text");
  if (!["text", "json", "github", "markdown"].includes(format)) throw new PackpeekError(`Unknown --format "${format}".`);
  const width = Math.max(60, Math.min(process.stdout.columns ?? 100, 110));
  const top = values.top ? Math.max(1, parseInt(values.top, 10) || 5) : 5;
  const style = makeStyle(colorEnabled(process.stdout, Boolean(values["no-color"])));
  const loadOpts = { cwd, pack: Boolean(values.pack), config };

  const [command, ...rest] = positionals;

  if (command === "rules") {
    for (const r of RULES) console.log(`${r.id.padEnd(16)} ${r.title}`);
    return 0;
  }

  if (command === "demo") {
    const dir = createLeakyProject();
    try {
      process.stderr.write(style.dim("Generated a deliberately leaky npm package in a temp dir. Nothing is published.\n"));
      const artifact = loadArtifact(dir, { ...loadOpts, cwd: dir });
      const report = analyze(artifact, config);
      process.stdout.write(renderText(report, artifact.files, style, { top, failOn: config.failOn, verbose: Boolean(values.verbose), width }));
      process.stderr.write(style.dim("Run `packpeek` inside your own package to see yours.\n"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return 0;
  }

  if (command === "diff") {
    const [oldTarget, newTarget] = rest;
    if (!oldTarget) throw new PackpeekError("Usage: packpeek diff <old> [new]");
    const oldA = loadArtifact(oldTarget, loadOpts);
    const newA = loadArtifact(newTarget, loadOpts);
    const d = diffArtifacts(oldA, newA, config);
    if (format === "json") process.stdout.write(renderDiffJson(d));
    else if (format === "markdown") process.stdout.write(renderDiffMarkdown(d));
    else if (format === "github") process.stdout.write(renderGithub({ ...d.next, findings: d.newFindings }));
    else process.stdout.write(renderDiffText(d, style, { top, width }));
    const maxGrowth = values["max-growth"] !== undefined ? parseFloat(values["max-growth"]) : undefined;
    const grew = maxGrowth !== undefined && d.growthPct > maxGrowth;
    if (grew) process.stderr.write(`Unpacked size grew ${d.growthPct.toFixed(1)}% (limit ${maxGrowth}%).\n`);
    const bad = config.failOn !== "none" && d.newFindings.some((f) => severityRank(f.severity) >= severityRank(config.failOn as "info"));
    return bad || grew ? 1 : 0;
  }

  if (rest.length > 0 || positionals.length > 1) throw new PackpeekError("Too many arguments. See `packpeek --help`.");
  const artifact = loadArtifact(command, loadOpts);
  const report = analyze(artifact, config);
  if (format === "json") process.stdout.write(renderJson(report));
  else if (format === "markdown") process.stdout.write(renderMarkdown(report));
  else if (format === "github") process.stdout.write(renderGithub(report));
  else process.stdout.write(renderText(report, artifact.files, style, { top, failOn: config.failOn, verbose: Boolean(values.verbose), width }));
  return exceedsThreshold(report, config) ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  const code = (e as { code?: string }).code ?? "";
  if (e instanceof PackpeekError || code.startsWith("ERR_PARSE_ARGS")) {
    process.stderr.write(`packpeek: ${(e as Error).message}\n`);
  } else if (e instanceof Error && e.message.startsWith("Invalid size")) {
    process.stderr.write(`packpeek: ${e.message}\n`);
  } else {
    process.stderr.write(`packpeek: unexpected error: ${(e as Error).stack ?? String(e)}\n`);
  }
  process.exitCode = 2;
}
