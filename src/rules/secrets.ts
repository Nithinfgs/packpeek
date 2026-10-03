import type { Finding, Rule, Severity } from "../types.js";
import { lineOf, redact } from "../util.js";

interface Pattern {
  id: string;
  label: string;
  re: RegExp;
  severity: Severity;
  /** Capture group holding the secret value (default: whole match). */
  group?: number;
}

// Patterns are intentionally anchored on vendor prefixes to keep false positives low.
const PATTERNS: Pattern[] = [
  { id: "aws-access-key", label: "AWS access key ID", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, severity: "high" },
  { id: "aws-secret", label: "AWS secret access key", re: /aws_?secret_?access_?key["']?\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})\b/gi, severity: "critical", group: 1 },
  { id: "github-token", label: "GitHub token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b/g, severity: "critical" },
  { id: "npm-token", label: "npm access token", re: /\bnpm_[A-Za-z0-9]{36}\b/g, severity: "critical" },
  { id: "pypi-token", label: "PyPI API token", re: /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}\b/g, severity: "critical" },
  { id: "slack-token", label: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, severity: "high" },
  { id: "stripe-live", label: "Stripe live key", re: /\b[sr]k_live_[A-Za-z0-9]{20,}\b/g, severity: "critical" },
  { id: "google-api-key", label: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, severity: "medium" },
  { id: "anthropic-key", label: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, severity: "critical" },
  { id: "openai-key", label: "OpenAI API key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b/g, severity: "critical" },
  { id: "private-key", label: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g, severity: "critical" },
  { id: "jwt", label: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, severity: "medium" },
];

const CONFIGISH = /(?:^|\/)(?:\.env(?:\.[^/]*)?|[^/]*\.(?:json|ya?ml|ini|cfg|toml|properties|conf))$/i;
const GENERIC = /\b(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)["']?\s*[=:]\s*["']([^"'\s]{12,})["']/gi;
const GENERIC_ENV = /^\s*(?:export\s+)?[A-Z0-9_]*(PASSWORD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY)[A-Z0-9_]*\s*=\s*["']?([^\s"'#]{8,})/gim;
const PLACEHOLDER = /example|your[_-]|changeme|placeholder|dummy|sample|xxxx|\*{4}|<[^>]+>|\$\{|process\.env|os\.environ|todo|redacted/i;
const SKIP_PATH = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json|Cargo\.lock|poetry\.lock)$/;

export const secretsRule: Rule = {
  id: "secret",
  title: "Credentials and tokens in shipped files",
  run(artifact) {
    const findings: Finding[] = [];
    for (const f of artifact.files) {
      if (SKIP_PATH.test(f.path)) continue;
      const text = f.text();
      if (!text) continue;
      const seen = new Set<string>();
      const specific = new Set<string>();

      const report = (p: { label: string; severity: Severity }, value: string, index: number): void => {
        const key = `${p.label}:${value}`;
        if (seen.has(key)) return;
        seen.add(key);
        findings.push({
          rule: this.id,
          severity: p.severity,
          path: f.path,
          line: lineOf(text, index),
          message: `${p.label} found in shipped file.`,
          detail: redact(value),
          hint: "Revoke and rotate this credential: anything published to a registry should be treated as public and cached forever. Then remove the file from the artifact.",
        });
      };

      for (const p of PATTERNS) {
        p.re.lastIndex = 0;
        for (const m of text.matchAll(p.re)) {
          const value = m[p.group ?? 0] ?? m[0];
          if (/EXAMPLE/.test(value)) continue; // AWS docs placeholders
          specific.add(value);
          report(p, value, m.index ?? 0);
        }
      }

      if (CONFIGISH.test(f.path)) {
        for (const re of [GENERIC, GENERIC_ENV]) {
          re.lastIndex = 0;
          for (const m of text.matchAll(re)) {
            const value = m[2] ?? "";
            if (specific.has(value) || PLACEHOLDER.test(value) || PLACEHOLDER.test(m[0])) continue;
            report({ label: "Hard-coded credential", severity: "medium" }, value, m.index ?? 0);
          }
        }
      }
    }
    return findings;
  },
};
