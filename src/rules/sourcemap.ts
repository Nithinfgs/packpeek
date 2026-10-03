import type { Artifact, Finding, Rule } from "../types.js";
import { formatBytes, plural } from "../util.js";

interface SourceMapJson {
  sources?: unknown;
  sourcesContent?: unknown;
}

const SCANNABLE = /\.(?:m?js|cjs|css|jsx?)$/i;

const OSS_LICENSE = /^(?:MIT|ISC|BSD(?:-[0-9]-Clause)?|Apache-2\.0|MPL-2\.0|0BSD|Unlicense|CC0-1\.0|(?:A|L)?GPL-[0-9.]+(?:-only|-or-later)?|\(.*(?:MIT|Apache|BSD|ISC).*\))$/i;

/** True when the package declares an open-source license, i.e. published source is probably intentional. */
function declaresOpenSource(files: Artifact["files"]): boolean {
  const pkg = files.find((f) => f.path === "package.json")?.text();
  if (pkg) {
    try {
      const lic = (JSON.parse(pkg) as { license?: unknown }).license;
      return typeof lic === "string" && OSS_LICENSE.test(lic.trim());
    } catch {
      return false;
    }
  }
  const meta = files.find((f) => /\.dist-info\/METADATA$/.test(f.path) || f.path === "PKG-INFO")?.text();
  return meta ? /^Classifier: License :: OSI Approved/m.test(meta) : false;
}

function isDependencySource(s: string): boolean {
  return s.includes("node_modules/") || s.includes("node_modules\\") || s.startsWith("webpack://") && s.includes("/external ");
}

export const sourcemapRule: Rule = {
  id: "sourcemap",
  title: "Source maps that expose original source",
  run(artifact) {
    const findings: Finding[] = [];
    const openSource = declaresOpenSource(artifact.files);
    const pathOnly: Array<{ path: string; size: number; count: number }> = [];

    for (const f of artifact.files) {
      if (!f.path.endsWith(".map")) continue;
      const text = f.text();
      let map: SourceMapJson | undefined;
      try {
        map = text ? (JSON.parse(text) as SourceMapJson) : undefined;
      } catch {
        map = undefined;
      }
      if (!map) {
        findings.push({ rule: this.id, severity: "low", path: f.path, message: `Source map file ships (${formatBytes(f.size)}) but could not be parsed.` });
        continue;
      }
      const sources = Array.isArray(map.sources) ? (map.sources as unknown[]).filter((s): s is string => typeof s === "string") : [];
      const contents = Array.isArray(map.sourcesContent) ? (map.sourcesContent as unknown[]) : [];
      const ownIdx = sources.map((s, i) => (isDependencySource(s) ? -1 : i)).filter((i) => i >= 0);
      const embedded = ownIdx.filter((i) => typeof contents[i] === "string" && (contents[i] as string).length > 0);
      if (embedded.length > 0) {
        const bytes = embedded.reduce((n, i) => n + Buffer.byteLength(contents[i] as string), 0);
        findings.push({
          rule: this.id,
          severity: openSource ? "low" : "high",
          path: f.path,
          message: `Embeds ${plural(embedded.length, "original source file")} (${formatBytes(bytes)}) verbatim in sourcesContent.${openSource ? " Package declares an open-source license, so this is probably intentional." : ""}`,
          hint: openSource
            ? "Fine for open source. If the source is not meant to be public, stop emitting maps for the published build."
            : "Anyone can recover your readable source from this package. Don't emit maps for the published build, set sourcesContent: false, or exclude *.map via the files allowlist.",
        });
      } else if (ownIdx.length > 0) {
        pathOnly.push({ path: f.path, size: f.size, count: ownIdx.length });
      }
    }

    if (pathOnly.length > 0) {
      const total = pathOnly.reduce((n, m) => n + m.size, 0);
      findings.push({
        rule: this.id,
        severity: "low",
        path: pathOnly[0]!.path,
        message: `${plural(pathOnly.length, "source map")} ship (${formatBytes(total)}), listing original file paths; no source text embedded.`,
        detail: pathOnly.length > 1 ? `${pathOnly[0]!.path}, …` : undefined,
        hint: "Paths reveal project structure. Exclude *.map from the package unless you want consumers to debug into it.",
      });
    }

    for (const f of artifact.files) {
      if (!SCANNABLE.test(f.path)) continue;
      const text = f.text();
      if (!text) continue;
      const tail = text.slice(-2048);
      const m = /[#@]\s*sourceMappingURL=(\S+)\s*(?:\*\/)?\s*$/.exec(tail);
      if (!m) continue;
      const url = m[1]!;
      if (url.startsWith("data:")) {
        const b64 = /;base64,(.*)$/.exec(url)?.[1];
        let embeds = false;
        if (b64) {
          try {
            const decoded = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as SourceMapJson;
            embeds = Array.isArray(decoded.sourcesContent) && decoded.sourcesContent.length > 0;
          } catch {
            embeds = false;
          }
        }
        if (embeds) {
          findings.push({
            rule: this.id,
            severity: "high",
            path: f.path,
            message: "Inline base64 source map embeds original source text.",
            hint: "Build without inline source maps for the published artifact.",
          });
        }
      } else if (/^https?:\/\//i.test(url)) {
        findings.push({
          rule: this.id,
          severity: "medium",
          path: f.path,
          message: `sourceMappingURL points to an external location: ${url.length > 80 ? url.slice(0, 77) + "…" : url}`,
          hint: "Make sure that URL is meant to be public. Maps hosted on a storage bucket can expose the full source to anyone who has the link.",
        });
      }
    }
    return findings;
  },
};
