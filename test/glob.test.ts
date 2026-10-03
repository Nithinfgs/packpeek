import assert from "node:assert/strict";
import { test } from "node:test";
import { matchGlob } from "../src/glob.js";

test("basename patterns match at any depth", () => {
  assert.ok(matchGlob("*.map", "dist/a/b.js.map"));
  assert.ok(matchGlob("*.map", "x.map"));
  assert.ok(!matchGlob("*.map", "x.mapx"));
});

test("path patterns respect directories", () => {
  assert.ok(matchGlob("dist/**", "dist/a/b.js"));
  assert.ok(matchGlob("dist/*.js", "dist/a.js"));
  assert.ok(!matchGlob("dist/*.js", "dist/a/b.js"));
  assert.ok(matchGlob("**/fixtures/*.json", "test/fixtures/a.json"));
  assert.ok(matchGlob("**/fixtures/*.json", "fixtures/a.json"));
});

test("braces and question marks", () => {
  assert.ok(matchGlob("*.{js,ts}", "a.ts"));
  assert.ok(!matchGlob("*.{js,ts}", "a.py"));
  assert.ok(matchGlob("a?.txt", "ab.txt"));
});

test("dots are literal", () => {
  assert.ok(!matchGlob("a.b", "axb"));
});
