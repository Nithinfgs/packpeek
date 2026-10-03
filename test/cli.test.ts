import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FAKE, makeTgz, makeZip } from "./helpers.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.js");

function run(args: string[], cwd: string) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function withDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "packpeek-cli-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const leaky = { "package.json": JSON.stringify({ name: "leaky", version: "1.0.0", main: "index.js", files: ["index.js", ".env"] }), "index.js": "1", ".env": "A=1" };
const clean = { "package.json": JSON.stringify({ name: "clean", version: "1.0.0", main: "index.js", files: ["index.js"] }), "index.js": "1" };

test("--help and --version", () =>
  withDir((d) => {
    assert.match(run(["--help"], d).out, /Usage/);
    assert.match(run(["--version"], d).out, /^\d+\.\d+\.\d+/);
  }));

test("scan a tarball: leaky fails with exit 1, clean passes with exit 0", () =>
  withDir((d) => {
    writeFileSync(join(d, "leaky.tgz"), makeTgz(leaky));
    writeFileSync(join(d, "clean.tgz"), makeTgz(clean));
    const bad = run(["leaky.tgz"], d);
    assert.equal(bad.code, 1);
    assert.match(bad.out, /sensitive-file/);
    assert.match(bad.out, /leaky@1\.0\.0/);
    const ok = run(["clean.tgz"], d);
    assert.equal(ok.code, 0);
    assert.match(ok.out, /No findings/);
  }));

test("--fail-on none keeps exit 0; --json is valid and never contains full secrets", () =>
  withDir((d) => {
    const gh = FAKE.github();
    writeFileSync(join(d, "a.tgz"), makeTgz({ ...clean, "index.js": `const t="${gh}"` }));
    assert.equal(run(["a.tgz", "--fail-on", "none"], d).code, 0);
    const j = run(["a.tgz", "--json"], d);
    assert.equal(j.code, 1);
    const parsed = JSON.parse(j.out) as { findings: Array<{ rule: string }> };
    assert.equal(parsed.findings[0]!.rule, "secret");
    assert.ok(!j.out.includes(gh));
  }));

test("config file and --ignore suppress findings", () =>
  withDir((d) => {
    writeFileSync(join(d, "leaky.tgz"), makeTgz(leaky));
    writeFileSync(join(d, "packpeek.config.json"), JSON.stringify({ ignore: ["sensitive-file:.env"] }));
    const r = run(["leaky.tgz"], d);
    assert.equal(r.code, 0);
    assert.match(r.out, /suppressed by ignore rules/);
    rmSync(join(d, "packpeek.config.json"));
    assert.equal(run(["leaky.tgz", "--ignore", "sensitive-file"], d).code, 0);
  }));

test("wheel scanning flags a top-level tests package", () =>
  withDir((d) => {
    writeFileSync(join(d, "p-1.0-py3-none-any.whl"), makeZip({ "p/__init__.py": "", "tests/test_x.py": "" }));
    const r = run(["p-1.0-py3-none-any.whl", "--fail-on", "medium"], d);
    assert.equal(r.code, 1);
    assert.match(r.out, /python-layout/);
  }));

test("directory target without package.json is scanned as a tree", () =>
  withDir((d) => {
    mkdirSync(join(d, "site"));
    writeFileSync(join(d, "site", "app.js"), "x\n//# sourceMappingURL=https://cdn.example.com/x.map\n");
    const r = run(["site", "--fail-on", "medium"], d);
    assert.equal(r.code, 1);
    assert.match(r.out, /sourcemap/);
  }));

test("npm project directory uses npm pack --dry-run", () =>
  withDir((d) => {
    for (const [p, c] of Object.entries(leaky)) writeFileSync(join(d, p), c);
    const r = run(["--format", "github"], d);
    assert.equal(r.code, 1);
    assert.match(r.out, /^::error file=\.env,title=packpeek sensitive-file/m);
  }));

test("diff command: new leak fails; --max-growth enforced", () =>
  withDir((d) => {
    writeFileSync(join(d, "old.tgz"), makeTgz(clean));
    writeFileSync(join(d, "new.tgz"), makeTgz({ ...leaky, "big.js": "x".repeat(50_000) }));
    const r = run(["diff", "old.tgz", "new.tgz"], d);
    assert.equal(r.code, 1);
    assert.match(r.out, /NEW FILES/);
    assert.match(r.out, /\.env/);
    const g = run(["diff", "old.tgz", "new.tgz", "--fail-on", "none", "--max-growth", "50"], d);
    assert.equal(g.code, 1);
    assert.match(g.err, /grew/);
    assert.equal(run(["diff", "old.tgz", "old.tgz"], d).code, 0);
  }));

test("markdown format", () =>
  withDir((d) => {
    writeFileSync(join(d, "leaky.tgz"), makeTgz(leaky));
    const r = run(["leaky.tgz", "--format", "markdown"], d);
    assert.match(r.out, /### packpeek: `leaky@1\.0\.0`/);
    assert.match(r.out, /\| severity|\| Severity/i);
  }));

test("errors exit 2 with a message, not a stack trace", () =>
  withDir((d) => {
    const missing = run(["nope.tgz"], d);
    assert.equal(missing.code, 2);
    assert.match(missing.err, /Not found/);
    assert.equal(run(["--fail-on", "bogus", "."], d).code, 2);
    assert.equal(run(["--max-file-size", "lots", "."], d).code, 2);
    assert.equal(run(["--bogus-flag"], d).code, 2);
    writeFileSync(join(d, "bad.tgz"), "not gzip");
    const bad = run(["bad.tgz"], d);
    assert.equal(bad.code, 2);
    assert.doesNotMatch(bad.err, /at .*\.js:\d+/);
  }));

test("rules and demo commands", () =>
  withDir((d) => {
    assert.match(run(["rules"], d).out, /sourcemap/);
    const demo = run(["demo"], d);
    assert.equal(demo.code, 0);
    assert.match(demo.out, /acme-cli@2\.4\.0/);
    assert.match(demo.out, /CRITICAL/);
  }));
