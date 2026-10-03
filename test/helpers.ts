import { deflateRawSync, gzipSync } from "node:zlib";
import type { Artifact, ArtifactKind, Config } from "../src/types.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import { makeEntry } from "../src/util.js";

export type Files = Record<string, string | Buffer>;

export function cfg(over: Partial<Config> = {}): Config {
  return { ...DEFAULT_CONFIG, ignore: [], only: [], ...over };
}

export function art(files: Files, kind: ArtifactKind = "npm"): Artifact {
  return {
    kind,
    source: "test",
    files: Object.entries(files).map(([path, content]) => {
      const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
      return makeEntry(path, buf.length, () => buf, DEFAULT_CONFIG.maxScanSize);
    }),
  };
}

function octal(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, "0") + "\0";
}

/** Minimal ustar writer. Long names go through the `prefix` field or a GNU long-name record. */
export function makeTar(files: Files, root = "package"): Buffer {
  const blocks: Buffer[] = [];
  const header = (name: string, size: number, type = "0"): Buffer => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 100), 0, "utf8");
    h.write(octal(0o644, 8), 100);
    h.write(octal(0, 8), 108);
    h.write(octal(0, 8), 116);
    h.write(octal(size, 12), 124);
    h.write(octal(0, 12), 136);
    h.write("        ", 148);
    h.write(type, 156);
    h.write("ustar\0", 257);
    h.write("00", 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    return h;
  };
  const pad = (b: Buffer): Buffer => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
  for (const [path, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const full = root ? `${root}/${path}` : path;
    if (Buffer.byteLength(full) > 100) {
      const nameBuf = Buffer.from(full + "\0");
      blocks.push(header("././@LongLink", nameBuf.length, "L"), pad(nameBuf));
    }
    blocks.push(header(full, data.length), pad(data));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

export function makeTgz(files: Files, root = "package"): Buffer {
  return gzipSync(makeTar(files, root));
}

export function makeZip(files: Files, opts: { stored?: boolean } = {}): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const comp = opts.stored ? data : deflateRawSync(data);
    const method = opts.stored ? 0 : 8;
    const name = Buffer.from(path);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const local = Buffer.concat([lh, name, comp]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([ch, name]));
    locals.push(local);
    offset += local.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** Assemble token-shaped strings at runtime so no secret-looking literals live in the repo. */
export const FAKE = {
  github: () => "ghp_" + "aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bD1fH3jL5".slice(0, 36),
  stripe: () => "sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc",
  aws: () => "AKIA" + "QWERTY12345ZXCVB".slice(0, 16),
  npm: () => "npm_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8".slice(0, 36),
};
