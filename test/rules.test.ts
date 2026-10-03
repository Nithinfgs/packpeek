import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze, exceedsThreshold } from "../src/analyze.js";
import { art, cfg, FAKE } from "./helpers.js";

const rules = (files: Parameters<typeof art>[0], kind?: Parameters<typeof art>[1], over = {}) => analyze(art(files, kind), cfg(over)).findings;
const by = (f: ReturnType<typeof rules>, rule: string) => f.filter((x) => x.rule === rule);

test("sourcemap: embedded sourcesContent is high; deps-only is not flagged as embedding", () => {
  const own = JSON.stringify({ version: 3, sources: ["../src/a.ts"], sourcesContent: ["const a = 1;"] });
  const deps = JSON.stringify({ version: 3, sources: ["../node_modules/x/i.js"], sourcesContent: ["x"] });
  const f = by(rules({ "dist/a.js.map": own, "dist/b.js.map": deps }), "sourcemap");
  assert.equal(f.length, 1);
  assert.equal(f[0]!.severity, "high");
  assert.equal(f[0]!.path, "dist/a.js.map");
});

test("sourcemap: map without content is low; unparsable is low", () => {
  const f = by(rules({ "a.js.map": JSON.stringify({ sources: ["../src/a.ts"] }), "b.js.map": "{oops" }), "sourcemap");
  assert.deepEqual(f.map((x) => x.severity), ["low", "low"]);
});

test("sourcemap: external URL and inline base64 maps", () => {
  const inline = Buffer.from(JSON.stringify({ sources: ["a.ts"], sourcesContent: ["x"] })).toString("base64");
  const f = by(
    rules({
      "dist/a.js": "x\n//# sourceMappingURL=https://cdn.example.com/a.js.map\n",
      "dist/b.js": `y\n//# sourceMappingURL=data:application/json;base64,${inline}\n`,
      "dist/c.js": "z\n//# sourceMappingURL=c.js.map\n",
    }),
    "sourcemap",
  );
  assert.equal(f.length, 2);
  assert.equal(f.find((x) => x.path === "dist/a.js")!.severity, "medium");
  assert.equal(f.find((x) => x.path === "dist/b.js")!.severity, "high");
});

test("secret: detects vendor tokens, redacts values, reports line", () => {
  const gh = FAKE.github();
  const f = by(rules({ "src/a.js": `// hi\nconst t = "${gh}";\n` }), "secret");
  assert.equal(f.length, 1);
  assert.equal(f[0]!.severity, "critical");
  assert.equal(f[0]!.line, 2);
  assert.ok(!JSON.stringify(f).includes(gh), "full token must never appear in output");
  assert.ok(f[0]!.detail!.startsWith("ghp_"));
});

test("secret: aws, npm, stripe, private key", () => {
  const f = by(
    rules({
      "a.txt": FAKE.aws(),
      "b.txt": FAKE.npm(),
      "c.txt": FAKE.stripe(),
      "d.txt": "-----BEGIN RSA PRIVATE KEY-----\nabc\n",
    }),
    "secret",
  );
  assert.equal(f.length, 4);
});

test("secret: placeholders and AWS docs keys are ignored", () => {
  const f = by(
    rules({
      ".env": "API_KEY=your-api-key-here\nDB_PASSWORD=${DB_PASSWORD}\nTOKEN=changeme-please-now\n",
      "readme.txt": "AKIAIOSFODNN7EXAMPLE",
    }),
    "secret",
  );
  assert.equal(f.length, 0);
});

test("secret: generic assignment in config files, not double-reported with specific", () => {
  const f = by(rules({ ".env": `SESSION_SECRET=8f3c1a9d0b7e44f2a6d5c91e\nSTRIPE_SECRET_KEY=${FAKE.stripe()}\n` }), "secret");
  assert.equal(f.length, 2);
  assert.equal(f.filter((x) => x.severity === "critical").length, 1);
});

test("secret: lockfiles and binaries are skipped", () => {
  const f = by(rules({ "package-lock.json": FAKE.github(), "x.bin": Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(FAKE.github())]) }), "secret");
  assert.equal(f.length, 0);
});

test("sensitive-file: .env ships, .env.example does not", () => {
  const f = by(rules({ ".env": "A=1", ".env.example": "A=", "keys/server.pem": "x", ".DS_Store": "" }), "sensitive-file");
  assert.deepEqual(f.map((x) => x.path).sort(), [".DS_Store", ".env", "keys/server.pem"]);
});

test("sensitive-file: .npmrc severity depends on whether it has a literal token", () => {
  const real = by(rules({ ".npmrc": `//registry.npmjs.org/:_authToken=${FAKE.npm()}` }), "sensitive-file");
  const env = by(rules({ ".npmrc": "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" }), "sensitive-file");
  assert.equal(real[0]!.severity, "critical");
  assert.equal(env[0]!.severity, "low");
});

test("sensitive-file: .git directory is one finding", () => {
  const f = by(rules({ ".git/HEAD": "x", ".git/config": "y" }), "sensitive-file");
  assert.equal(f.length, 1);
  assert.equal(f[0]!.severity, "high");
});

test("local-path: personal paths flagged, CI/generic users ignored", () => {
  const f = by(
    rules({
      "a.js": 'const p = "/Users/jane.doe/code/app/src";',
      "b.js": 'const p = "/home/runner/work/app";',
      "c.js": 'path: "C:\\\\Users\\\\Bob\\\\proj"',
      "d.md": "see /home/user/example",
    }),
    "local-path",
  );
  assert.deepEqual(f.map((x) => x.path).sort(), ["a.js", "c.js"]);
});

test("npm-manifest: missing main/bin/types target is high", () => {
  const pkg = JSON.stringify({ name: "x", main: "dist/index.js", types: "dist/index.d.ts", bin: { x: "bin/x.js" }, files: ["dist"] });
  const f = by(rules({ "package.json": pkg, "dist/index.js": "1" }), "npm-manifest");
  const missing = f.filter((x) => x.severity === "high").map((x) => x.message);
  assert.equal(missing.length, 2);
  assert.ok(missing.some((m) => m.includes("types")));
  assert.ok(missing.some((m) => m.includes("bin.x")));
});

test("npm-manifest: exports map, subpath without extension, and wildcards are handled", () => {
  const pkg = JSON.stringify({ name: "x", files: ["dist"], exports: { ".": { import: "./dist/a.mjs", require: "./dist/a.cjs" }, "./feat/*": "./dist/feat/*.js" } });
  const f = by(rules({ "package.json": pkg, "dist/a.mjs": "1", "dist/a.cjs": "1" }), "npm-manifest");
  assert.equal(f.filter((x) => x.severity === "high").length, 0);
});

test("npm-manifest: warns about no files allowlist; reports lifecycle scripts as info", () => {
  const pkg = JSON.stringify({ name: "x", scripts: { postinstall: "node s.js" } });
  const f = by(rules({ "package.json": pkg }), "npm-manifest");
  assert.ok(f.some((x) => x.severity === "medium" && x.message.includes("files")));
  assert.ok(f.some((x) => x.severity === "info" && x.message.includes("postinstall")));
});

test("python-layout: top-level tests package in wheel", () => {
  const f = by(rules({ "mypkg/__init__.py": "", "tests/test_a.py": "", "tests/conftest.py": "" }, "python-wheel"), "python-layout");
  assert.equal(f.length, 1);
  assert.equal(f[0]!.severity, "medium");
});

test("unintended: groups by category; sdist tolerates tests; trees are skipped", () => {
  const files = { "package.json": "{}", "test/a.test.js": "x", "coverage/index.html": "x".repeat(10), ".github/workflows/ci.yml": "x" };
  const npm = by(rules(files), "unintended").map((x) => x.message);
  assert.equal(npm.length, 3);
  assert.equal(by(rules(files, "python-sdist"), "unintended").length, 1); // only coverage
  assert.equal(by(rules(files, "tree"), "unintended").length, 0);
});

test("size: large files and identical duplicates", () => {
  const big = "a".repeat(2048);
  const dup = "b".repeat(12 * 1024);
  const f = by(rules({ "big.bin": big, "x/one.js": dup, "y/two.js": dup }, "npm", { maxFileSize: 1024 }), "size");
  assert.ok(f.some((x) => x.path === "big.bin" && x.message.startsWith("Large file")));
  assert.ok(f.some((x) => x.message.includes("2 identical copies")));
});

test("size: total size limit", () => {
  const f = by(rules({ "a.js": "x".repeat(5000) }, "npm", { maxTotalSize: 1000 }), "size");
  assert.equal(f.length, 1);
});

test("ignore rules suppress findings by rule and optional path glob", () => {
  const files = { ".env": "A=1", "keys/a.pem": "x" };
  assert.equal(analyze(art(files), cfg({ ignore: [{ rule: "sensitive-file" }] })).findings.length, 0);
  const r = analyze(art(files), cfg({ ignore: [{ rule: "sensitive-file", path: "*.pem" }] }));
  assert.deepEqual(r.findings.map((x) => x.path), [".env"]);
  assert.equal(r.ignored, 1);
});

test("--rule filter rejects unknown ids", () => {
  assert.throws(() => analyze(art({}), cfg({ only: ["nope"] })), /Unknown rule/);
});

test("exceedsThreshold respects failOn", () => {
  const r = analyze(art({ ".env": "A=1" }), cfg());
  assert.ok(exceedsThreshold(r, { failOn: "high" }));
  assert.ok(!exceedsThreshold(r, { failOn: "critical" }));
  assert.ok(!exceedsThreshold(r, { failOn: "none" }));
});

test("sourcemap: open-source license downgrades embedded source to low; proprietary stays high", () => {
  const map = JSON.stringify({ sources: ["../src/a.ts"], sourcesContent: ["const a = 1;"] });
  const oss = by(rules({ "package.json": JSON.stringify({ name: "x", license: "MIT" }), "dist/a.js.map": map }), "sourcemap");
  const closed = by(rules({ "package.json": JSON.stringify({ name: "x", license: "SEE LICENSE IN LICENSE.md" }), "dist/a.js.map": map }), "sourcemap");
  const unknown = by(rules({ "dist/a.js.map": map }), "sourcemap");
  assert.equal(oss[0]!.severity, "low");
  assert.equal(closed[0]!.severity, "high");
  assert.equal(unknown[0]!.severity, "high");
});

test("sourcemap: many path-only maps collapse into one finding", () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 30; i++) files[`dist/f${i}.js.map`] = JSON.stringify({ sources: [`../src/f${i}.ts`] });
  const f = by(rules(files), "sourcemap");
  assert.equal(f.length, 1);
  assert.match(f[0]!.message, /30 source maps/);
});

test("local-path: prose and docstrings are low, generated files medium", () => {
  const f = by(rules({ "lib/doc.py": '"""see /home/guido/src/data.txt"""', "dist/a.js": 'x="/Users/jane/app"' }), "local-path");
  assert.equal(f.find((x) => x.path === "lib/doc.py")!.severity, "low");
  assert.equal(f.find((x) => x.path === "dist/a.js")!.severity, "medium");
});
