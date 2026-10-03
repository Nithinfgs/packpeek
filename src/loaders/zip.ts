import { inflateRawSync } from "node:zlib";
import { PackpeekError } from "../types.js";
import type { RawEntry } from "./tar.js";

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** Parse a zip (wheel, .zip) from memory. Supports stored and deflate entries. */
export function parseZip(buf: Buffer): RawEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new PackpeekError("Not a valid zip/wheel file (end of central directory not found).");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new PackpeekError("zip64 archives are not supported yet.");
  }
  const out: RawEntry[] = [];
  let off = cdOffset;
  for (let n = 0; n < count; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CD_SIG) throw new PackpeekError("Corrupt zip central directory.");
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || (flags & 1) !== 0) continue; // directory or encrypted
    out.push({
      path: name,
      size,
      data: () => {
        if (buf.readUInt32LE(localOff) !== LOCAL_SIG) throw new PackpeekError(`Corrupt zip entry: ${name}`);
        const start = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
        const raw = buf.subarray(start, start + compSize);
        if (method === 0) return raw;
        if (method === 8) return inflateRawSync(raw);
        throw new PackpeekError(`Unsupported zip compression method ${method} for ${name}`);
      },
    });
  }
  return out;
}
