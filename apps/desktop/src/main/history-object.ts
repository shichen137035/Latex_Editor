import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const magic = Buffer.from("TWHOBJ\0\x01", "binary");
const digest = (content: Buffer) => createHash("sha256").update(content).digest("hex");

/** Object IDs always describe the original bytes, independent of storage encoding. */
export async function encodeHistoryObject(content: Buffer): Promise<Buffer> {
  if (content.length < 1024) return content;
  const compressed = await compress(content, { level: 6 });
  // Avoid adding CPU cost and an envelope for already compressed or tiny resources.
  if (compressed.length + magic.length > content.length * 0.9) return content;
  return Buffer.concat([magic, compressed]);
}

export async function decodeHistoryObject(stored: Buffer, id: string): Promise<Buffer> {
  // Existing raw objects remain readable, even if their content starts with the magic.
  if (digest(stored) === id) return stored;
  if (stored.subarray(0, magic.length).equals(magic)) {
    try {
      const content = await decompress(stored.subarray(magic.length));
      if (digest(content) === id) return content;
    } catch { /* Report corruption consistently, before any restore writes. */ }
  }
  throw new Error("History object is damaged");
}
