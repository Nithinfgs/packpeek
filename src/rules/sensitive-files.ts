import type { Finding, Rule, Severity } from "../types.js";
import { basename } from "../util.js";

interface PathRule {
  test: (path: string, base: string) => boolean;
  severity: Severity;
  why: string;
}

const ENV_TEMPLATE = /^\.env\.(?:example|sample|template|dist|defaults?)$/i;

const PATH_RULES: PathRule[] = [
  {
    test: (_p, b) => /^\.env(?:\.|$)/i.test(b) && !ENV_TEMPLATE.test(b),
    severity: "high",
    why: "Environment file. These usually hold real credentials.",
  },
  { test: (_p, b) => /^id_(?:rsa|dsa|ecdsa|ed25519)$/.test(b), severity: "critical", why: "SSH private key." },
  { test: (_p, b) => /\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(b), severity: "high", why: "Certificate or key material." },
  { test: (_p, b) => b === ".npmrc" || b === ".pypirc" || b === ".netrc" || b === ".htpasswd", severity: "high", why: "Registry or HTTP credentials file." },
  { test: (p) => /(?:^|\/)\.git\//.test(p), severity: "high", why: "Git metadata includes full history, remotes and sometimes credentials." },
  { test: (p) => /(?:^|\/)\.(?:aws|ssh|gnupg|kube)\//.test(p), severity: "critical", why: "Credentials directory." },
  { test: (p) => /(?:^|\/)\.docker\/config\.json$/.test(p), severity: "high", why: "Docker registry credentials." },
  { test: (_p, b) => /^terraform\.tfstate(?:\.backup)?$/.test(b), severity: "high", why: "Terraform state contains resource secrets in plain text." },
  { test: (_p, b) => /^(?:credentials|secrets?)\.(?:json|ya?ml)$/i.test(b) || /^service[-_]?account.*\.json$/i.test(b), severity: "high", why: "Looks like a credentials file." },
  { test: (_p, b) => /\.(?:sqlite3?|db|mdb)$/i.test(b), severity: "medium", why: "Database file. May contain real data." },
  { test: (_p, b) => /\.(?:sql|dump|bak)$/i.test(b), severity: "medium", why: "Dump or backup file." },
  { test: (_p, b) => b === ".DS_Store" || b === "Thumbs.db", severity: "low", why: "OS metadata file." },
  { test: (_p, b) => /\.log$/i.test(b) || b === "npm-debug.log", severity: "low", why: "Log file; can contain paths, tokens and request data." },
];

export const sensitiveFilesRule: Rule = {
  id: "sensitive-file",
  title: "Files that should not ship",
  run(artifact) {
    const findings: Finding[] = [];
    const gitFiles: string[] = [];
    for (const f of artifact.files) {
      const base = basename(f.path);
      if (/(?:^|\/)\.git\//.test(f.path)) {
        gitFiles.push(f.path);
        continue;
      }
      for (const r of PATH_RULES) {
        if (!r.test(f.path, base)) continue;
        let severity = r.severity;
        if (base === ".npmrc") {
          const t = f.text() ?? "";
          severity = /_auth(?:Token)?\s*=\s*(?!\$\{)\S+/i.test(t) ? "critical" : "low";
        }
        findings.push({
          rule: this.id,
          severity,
          path: f.path,
          message: r.why,
          hint: "Exclude it with the package.json files allowlist, .npmignore, MANIFEST.in or your build config.",
        });
        break;
      }
    }
    if (gitFiles.length > 0) {
      findings.push({
        rule: this.id,
        severity: "high",
        path: gitFiles[0],
        message: `.git directory ships (${gitFiles.length} files). Git metadata includes full history and remotes.`,
        hint: "Exclude .git from the artifact.",
      });
    }
    return findings;
  },
};
