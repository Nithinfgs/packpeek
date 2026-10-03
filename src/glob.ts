/**
 * Tiny glob matcher: `**`, `*`, `?`, `{a,b}`. Paths use forward slashes.
 * A pattern with no slash matches against the basename at any depth.
 */
export function globToRegExp(pattern: string): RegExp {
  let re = "";
  let i = 0;
  let braceDepth = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i += 2;
        if (pattern[i] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
        continue;
      }
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "{") {
      braceDepth++;
      re += "(?:";
    } else if (c === "}" && braceDepth > 0) {
      braceDepth--;
      re += ")";
    } else if (c === "," && braceDepth > 0) {
      re += "|";
    } else if (/[.+^$()|[\]\\]/.test(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
    i++;
  }
  return new RegExp(`^${re}$`);
}

export function matchGlob(pattern: string, path: string): boolean {
  const target = pattern.includes("/") ? path : path.slice(path.lastIndexOf("/") + 1);
  return globToRegExp(pattern.replace(/^\.\//, "")).test(target);
}
