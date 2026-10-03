import type { Finding, Rule } from "../types.js";
import { lineOf, plural } from "../util.js";

const POSIX = /\/(?:Users|home)\/([A-Za-z0-9._-]+)\/[^\s"'`<>)\]},;]*/g;
const WINDOWS = /[A-Za-z]:\\{1,2}Users\\{1,2}([A-Za-z0-9._ -]+?)\\{1,2}[^\s"'`<>)\]},;]*/g;
// Paths in generated output and config are real leaks; in docstrings and prose they are usually examples.
const GENERATED = /\.(?:m?js|cjs|map|json|css|html|cfg|ini|toml|ya?ml|env|so|dll)$|(?:^|\/)\.env/i;
// Generic CI / container / docs usernames: not personal, so not worth flagging.
const GENERIC_USERS = /^(?:runner|vsts|node|user|username|you|your-?name|name|me|app|appuser|builder|build|travis|circleci|docker|ubuntu|example|foo|bar|test|vagrant|codespace|gitpod|jenkins|buildkite-agent|\.\.\.|<[^>]*>|\$\{?\w+\}?)$/i;

export const localPathsRule: Rule = {
  id: "local-path",
  title: "Build-machine paths baked into files",
  run(artifact) {
    const findings: Finding[] = [];
    for (const f of artifact.files) {
      const text = f.text();
      if (!text) continue;
      let count = 0;
      let first: { sample: string; index: number } | undefined;
      const users = new Set<string>();
      for (const re of [POSIX, WINDOWS]) {
        re.lastIndex = 0;
        for (const m of text.matchAll(re)) {
          const user = m[1] ?? "";
          if (GENERIC_USERS.test(user)) continue;
          count++;
          users.add(user);
          first ??= { sample: m[0], index: m.index ?? 0 };
        }
      }
      if (count === 0 || !first) continue;
      const sample = first.sample.length > 70 ? first.sample.slice(0, 67) + "…" : first.sample;
      findings.push({
        rule: this.id,
        severity: GENERATED.test(f.path) ? "medium" : "low",
        path: f.path,
        line: lineOf(text, first.index),
        message: `${plural(count, "absolute path")} from a developer machine (user: ${[...users].slice(0, 3).join(", ")}).`,
        detail: sample,
        hint: "Leaks usernames and directory layout. Usually comes from bundler config, source maps or generated code; use relative paths.",
      });
    }
    return findings;
  },
};
