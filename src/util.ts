import { createHash } from "node:crypto";
import type { FileEntry } from "./types.js";

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function parseSize(input: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|k|mb|m|gb|g)?$/i.exec(input.trim());
  if (!m) throw new Error(`Invalid size "${input}". Use e.g. 500kb, 2mb, 1gb.`);
  const n = parseFloat(m[1]!);
  const unit = (m[2] ?? "b").toLowerCase();
  const mult = unit.startsWith("g") ? 1024 ** 3 : unit.startsWith("m") ? 1024 ** 2 : unit.startsWith("k") ? 1024 : 1;
  return Math.round(n * mult);
}

export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** 1-based line number of a character index. */
export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Show enough of a secret to recognise it, never enough to use it. */
export function redact(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}…(${value.length} chars)`;
}

export function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

export function makeEntry(path: string, size: number, load: () => Buffer, maxScanSize: number): FileEntry {
  let cache: Buffer | undefined;
  let textCache: string | null | undefined;
  let hash: string | undefined;
  const bytes = (): Buffer => (cache ??= load());
  return {
    path,
    size,
    bytes,
    text() {
      if (textCache !== undefined) return textCache ?? undefined;
      if (size > maxScanSize) {
        textCache = null;
        return undefined;
      }
      const b = bytes();
      textCache = looksBinary(b) ? null : b.toString("utf8");
      return textCache ?? undefined;
    },
    sha256() {
      return (hash ??= createHash("sha256").update(bytes()).digest("hex"));
    },
  };
}
