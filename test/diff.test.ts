import assert from "node:assert/strict";
import { test } from "node:test";
import { diffArtifacts } from "../src/diff.js";
import { art, cfg } from "./helpers.js";

test("diff reports added/removed/changed files, growth and only new findings", () => {
  const oldA = art({ "package.json": '{"name":"x","files":["dist"]}', "dist/a.js": "1", "dist/gone.js": "zz", ".env": "A=1" });
  const newA = art({
    "package.json": '{"name":"x","files":["dist"]}',
    "dist/a.js": "22",
    "dist/a.js.map": JSON.stringify({ sources: ["../src/a.ts"], sourcesContent: ["x".repeat(5000)] }),
    ".env": "A=1",
  });
  const d = diffArtifacts(oldA, newA, cfg());
  assert.deepEqual(d.added.map((f) => f.path), ["dist/a.js.map"]);
  assert.deepEqual(d.removed.map((f) => f.path), ["dist/gone.js"]);
  assert.deepEqual(d.changed.map((f) => f.path), ["dist/a.js"]);
  assert.ok(d.sizeDelta > 4000);
  assert.ok(d.growthPct > 100);
  assert.deepEqual(d.newFindings.map((f) => f.rule), ["sourcemap"]); // .env already existed
});

test("diff counts resolved findings", () => {
  const d = diffArtifacts(art({ ".env": "A=1" }), art({ "a.js": "1" }), cfg());
  assert.equal(d.resolvedFindings, 1);
  assert.equal(d.newFindings.length, 0);
});
