import type { Rule } from "../types.js";
import { localPathsRule } from "./local-paths.js";
import { npmManifestRule } from "./npm-manifest.js";
import { pythonLayoutRule } from "./python-layout.js";
import { secretsRule } from "./secrets.js";
import { sensitiveFilesRule } from "./sensitive-files.js";
import { sizeRule } from "./size.js";
import { sourcemapRule } from "./sourcemap.js";
import { unintendedRule } from "./unintended.js";

export const RULES: Rule[] = [
  sourcemapRule,
  secretsRule,
  sensitiveFilesRule,
  localPathsRule,
  npmManifestRule,
  pythonLayoutRule,
  unintendedRule,
  sizeRule,
];
