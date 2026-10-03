// Renders the real output of `packpeek demo` into docs/assets/demo.svg.
// Usage: npm run build && node scripts/render-demo-svg.mjs
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_LINES = Number(process.env.MAX_LINES ?? 42);

const r = spawnSync(process.execPath, [join(root, "dist/src/cli.js"), "demo", "--top", "3"], {
  encoding: "utf8",
  env: { ...process.env, FORCE_COLOR: "1", NO_COLOR: "" },
});
const all = r.stdout.replace(/\n+$/, "").split("\n").slice(1); // drop the leading blank line
const hidden = all.slice(MAX_LINES).filter((l) => l.includes("●")).length;
const lines = all.slice(0, MAX_LINES);

const COLORS = { 31: "#ff7b72", 32: "#7ee787", 33: "#e3b341", 35: "#d2a8ff", 36: "#79c0ff", 90: "#8b949e" };
const FG = "#c9d1d9";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function spans(line) {
  let fill = FG;
  let bold = false;
  let dim = false;
  let out = "";
  const re = /\u001b\[(\d+)m/g;
  let last = 0;
  const emit = (text) => {
    if (!text) return;
    const attrs = [`fill="${fill}"`];
    if (bold) attrs.push('font-weight="700"');
    if (dim) attrs.push('opacity="0.7"');
    out += `<tspan ${attrs.join(" ")}>${esc(text)}</tspan>`;
  };
  for (let m; (m = re.exec(line)); ) {
    emit(line.slice(last, m.index));
    last = re.lastIndex;
    const c = Number(m[1]);
    if (c === 1) bold = true;
    else if (c === 2) dim = true;
    else if (c === 22) bold = dim = false;
    else if (c === 39) fill = FG;
    else if (COLORS[c]) fill = COLORS[c];
  }
  emit(line.slice(last));
  return out;
}

const prompt = `<tspan fill="#7ee787">$</tspan><tspan fill="${FG}"> npx packpeek demo</tspan>`;
const rows = [prompt, ...lines.map(spans)];
if (hidden > 0) rows.push(`<tspan fill="#8b949e">  … ${hidden} more findings. Run it yourself to see them all.</tspan>`);

const LH = 19;
const top = 52;
const width = 940;
const height = top + rows.length * LH + 24;
const text = rows
  .map((row, i) => `<text x="24" y="${top + i * LH}" xml:space="preserve">${row}</text>`)
  .join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Terminal output of packpeek demo: a leaky npm package with critical secrets, an embedded source map and a broken types entry">
<style>
  text { font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; white-space: pre; }
</style>
<rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
<rect width="${width}" height="32" rx="10" fill="#161b22"/>
<rect y="22" width="${width}" height="10" fill="#161b22"/>
<circle cx="20" cy="16" r="6" fill="#ff5f56"/><circle cx="40" cy="16" r="6" fill="#ffbd2e"/><circle cx="60" cy="16" r="6" fill="#27c93f"/>
<text x="${width / 2}" y="20" fill="#8b949e" text-anchor="middle" style="font-size:12px">packpeek demo</text>
${text}
</svg>
`;
const out = join(root, "docs/assets/demo.svg");
writeFileSync(out, svg);
console.log(`wrote ${out} (${(svg.length / 1024).toFixed(1)} KB, ${rows.length} rows)`);
