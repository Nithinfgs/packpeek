import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadArtifact } from "../src/loaders/index.js";
import { parseTgz } from "../src/loaders/tar.js";
import { parseZip } from "../src/loaders/zip.js";
import { PackpeekError } from "../src/types.js";
import { cfg, makeTgz, makeZip } from "./helpers.js";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "packpeek-test-"));
}
const opts = (cwd: string) => ({ cwd, pack: false, config: cfg() });

test("tar parser reads files and long names", () => {
  const long = "a/".repeat(60) + "file.txt";
  const entries = parseTgz(makeTgz({ "x.txt": "hi", [long]: "deep" }));
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.path, "package/x.txt");
  assert.equal(entries[0]!.data().toString(), "hi");
  assert.equal(entries[1]!.path, "package/" + long);
});

test("zip parser reads deflate and stored entries", () => {
  for (const stored of [false, true]) {
    const entries = parseZip(makeZip({ "a/b.txt": "hello".repeat(100), "c.txt": "x" }, { stored }));
    assert.deepEqual(entries.map((e) => e.path), ["a/b.txt", "c.txt"]);
    assert.equal(entries[0]!.data().toString(), "hello".repeat(100));
  }
});

test("garbage input produces a friendly error", () => {
  assert.throws(() => parseZip(Buffer.from("nope")), PackpeekError);
  assert.throws(() => parseTgz(Buffer.from("nope")), PackpeekError);
});

test("npm tarball: strips package/ root and reads metadata", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "a.tgz"), makeTgz({ "package.json": JSON.stringify({ name: "foo", version: "1.2.3" }), "index.js": "1" }));
    const a = loadArtifact("a.tgz", opts(dir));
    assert.equal(a.kind, "npm");
    assert.equal(a.name, "foo");
    assert.equal(a.version, "1.2.3");
    assert.deepEqual(a.files.map((f) => f.path).sort(), ["index.js", "package.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sdist and crate are detected", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "p.tar.gz"), makeTgz({ "PKG-INFO": "Name: pyfoo\nVersion: 0.9\n", "src/a.py": "1" }, "pyfoo-0.9"));
    const s = loadArtifact("p.tar.gz", opts(dir));
    assert.equal(s.kind, "python-sdist");
    assert.equal(s.name, "pyfoo");
    assert.equal(s.version, "0.9");
    writeFileSync(join(dir, "c.crate"), makeTgz({ "Cargo.toml": '[package]\nname = "crab"\nversion = "0.2.0"\n' }, "crab-0.2.0"));
    const c = loadArtifact("c.crate", opts(dir));
    assert.equal(c.kind, "crate");
    assert.equal(c.name, "crab");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wheel is detected and name/version parsed from filename", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "mypkg-1.0.0-py3-none-any.whl"), makeZip({ "mypkg/__init__.py": "", "mypkg-1.0.0.dist-info/METADATA": "Name: mypkg" }));
    const w = loadArtifact("mypkg-1.0.0-py3-none-any.whl", opts(dir));
    assert.equal(w.kind, "python-wheel");
    assert.equal(w.name, "mypkg");
    assert.equal(w.version, "1.0.0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("plain directory is read as a tree, skipping top-level .git", () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, "site/assets"), { recursive: true });
    mkdirSync(join(dir, "site/.git"));
    writeFileSync(join(dir, "site/index.html"), "<html/>");
    writeFileSync(join(dir, "site/assets/app.js"), "1");
    writeFileSync(join(dir, "site/.git/HEAD"), "ref");
    const a = loadArtifact("site", opts(dir));
    assert.equal(a.kind, "tree");
    assert.deepEqual(a.files.map((f) => f.path).sort(), ["assets/app.js", "index.html"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing and unsupported targets raise PackpeekError", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "x.txt"), "x");
    assert.throws(() => loadArtifact("nope.tgz", opts(dir)), PackpeekError);
    assert.throws(() => loadArtifact("x.txt", opts(dir)), /Don't know how to read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
