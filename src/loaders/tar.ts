import { gunzipSync } from "node:zlib";
import { PackpeekError } from "../types.js";

export interface RawEntry {
  path: string;
  size: number;
  data: () => Buffer;
}

function cstr(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const end = slice.indexOf(0);
  return (end === -1 ? slice : slice.subarray(0, end)).toString("utf8");
}

function parsePax(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let off = 0;
  while (off < data.length) {
    const space = data.indexOf(0x20, off);
    if (space === -1) break;
    const len = parseInt(data.toString("utf8", off, space), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = data.toString("utf8", space + 1, off + len - 1);
    const eq = record.indexOf("=");
    if (eq !== -1) out[record.slice(0, eq)] = record.slice(eq + 1);
    off += len;
  }
  return out;
}

/** Parse an uncompressed tar buffer. Regular files only; directories and links are skipped. */
export function parseTar(buf: Buffer): RawEntry[] {
  const out: RawEntry[] = [];
  let off = 0;
  let longName: string | undefined;
  let pax: Record<string, string> = {};
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = cstr(h, 0, 100);
    const size = parseInt(cstr(h, 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new PackpeekError("Corrupt tar archive (bad size field).");
    const type = String.fromCharCode(h[156] || 48);
    const prefix = cstr(h, 345, 155);
    const start = off + 512;
    const end = start + size;
    if (end > buf.length) throw new PackpeekError("Corrupt tar archive (truncated).");
    if (type === "L") {
      longName = cstr(buf, start, size);
    } else if (type === "x") {
      pax = parsePax(buf.subarray(start, end));
    } else if (type === "g") {
      // global pax header: ignore
    } else {
      if (type === "0") {
        const path = pax["path"] ?? longName ?? (prefix ? `${prefix}/${name}` : name);
        out.push({ path, size, data: () => buf.subarray(start, end) });
      }
      longName = undefined;
      pax = {};
    }
    off = start + Math.ceil(size / 512) * 512;
  }
  return out;
}

export function parseTgz(buf: Buffer): RawEntry[] {
  let raw: Buffer;
  try {
    raw = gunzipSync(buf);
  } catch {
    throw new PackpeekError("Not a valid gzip file. Expected a .tgz / .tar.gz / .crate archive.");
  }
  return parseTar(raw);
}
