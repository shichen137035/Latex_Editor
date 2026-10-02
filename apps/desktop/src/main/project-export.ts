import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { deflateRawSync } from "node:zlib";

const zip32Limit = 0xffff_ffff;
const excludedDirectories = new Set([".git", ".latex-editor", ".texweave", "node_modules"]);
const generatedExtensions = /\.(?:acn|acr|alg|aux|bcf|bbl|blg|fdb_latexmk|fls|glg|glo|gls|idx|ilg|ind|ist|lof|log|lol|lot|maf|mtc\d*|nav|out|run\.xml|snm|synctex(?:\.gz)?|toc|vrb|xdv)$/i;
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

interface ArchiveFile { absolutePath: string; relativePath: string }
interface CentralDirectoryEntry {
  name: Buffer;
  checksum: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function checksum32(data: Buffer): number {
  let checksum = 0xffff_ffff;
  for (const byte of data) checksum = crcTable[(checksum ^ byte) & 0xff]! ^ (checksum >>> 8);
  return (checksum ^ 0xffff_ffff) >>> 0;
}

function zipTimestamp(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
    : normalizedLeft === normalizedRight;
}

function shouldExcludeFile(relativePath: string, absolutePath: string, outputPath: string, generatedPdfPath?: string): boolean {
  const parts = relativePath.split(/[\\/]/);
  const name = parts.at(-1) ?? "";
  return samePath(absolutePath, outputPath)
    || (generatedPdfPath !== undefined && samePath(absolutePath, generatedPdfPath))
    || [".DS_Store", "Thumbs.db", "desktop.ini"].includes(name)
    || generatedExtensions.test(name);
}

async function collectProjectFiles(root: string, outputPath: string, generatedPdfPath?: string): Promise<ArchiveFile[]> {
  const files: ArchiveFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = resolve(directory, entry.name);
      const relativePath = relative(root, absolutePath).split(sep).join("/");
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name.toLocaleLowerCase("en-US"))) await visit(absolutePath);
      } else if (entry.isFile() && !shouldExcludeFile(relativePath, absolutePath, outputPath, generatedPdfPath)) {
        files.push({ absolutePath, relativePath });
      }
    }
  };
  await visit(root);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (files.length > 0xffff) throw new Error("This project has too many files for a ZIP archive.");
  return files;
}

function makeLocalHeader(file: CentralDirectoryEntry, timestamp: { time: number; day: number }): Buffer {
  const header = Buffer.alloc(30 + file.name.length);
  header.writeUInt32LE(0x0403_4b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6); // UTF-8 file names
  header.writeUInt16LE(8, 8); // DEFLATE
  header.writeUInt16LE(timestamp.time, 10);
  header.writeUInt16LE(timestamp.day, 12);
  header.writeUInt32LE(file.checksum, 14);
  header.writeUInt32LE(file.compressedSize, 18);
  header.writeUInt32LE(file.uncompressedSize, 22);
  header.writeUInt16LE(file.name.length, 26);
  header.writeUInt16LE(0, 28);
  file.name.copy(header, 30);
  return header;
}

function makeCentralHeader(file: CentralDirectoryEntry, timestamp: { time: number; day: number }): Buffer {
  const header = Buffer.alloc(46 + file.name.length);
  header.writeUInt32LE(0x0201_4b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(timestamp.time, 12);
  header.writeUInt16LE(timestamp.day, 14);
  header.writeUInt32LE(file.checksum, 16);
  header.writeUInt32LE(file.compressedSize, 20);
  header.writeUInt32LE(file.uncompressedSize, 24);
  header.writeUInt16LE(file.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0x20, 38); // DOS archive attribute
  header.writeUInt32LE(file.localHeaderOffset, 42);
  file.name.copy(header, 46);
  return header;
}

function makeEndRecord(entryCount: number, centralSize: number, centralOffset: number): Buffer {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x0605_4b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

/** Creates a portable ZIP of project files, leaving compiler caches and output artifacts out. */
export async function createProjectSourceArchive(rootPath: string, mainFile: string | undefined, outputPath: string): Promise<void> {
  const root = resolve(rootPath);
  const output = resolve(outputPath);
  const generatedPdfPath = mainFile ? resolve(root, `${basename(mainFile, extname(mainFile))}.pdf`) : undefined;
  const files = await collectProjectFiles(root, output, generatedPdfPath);
  const archiveRoot = basename(root) || "project";
  const destinationDirectory = dirname(output);
  await mkdir(destinationDirectory, { recursive: true });
  const temporaryPath = resolve(destinationDirectory, `.${basename(output)}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx");
  const entries: CentralDirectoryEntry[] = [];
  let offset = 0;
  let closed = false;
  const append = async (chunk: Buffer): Promise<number> => {
    if (offset + chunk.length > zip32Limit) throw new Error("This project is too large for a ZIP archive (maximum 4 GiB).");
    const start = offset;
    await handle.writeFile(chunk);
    offset += chunk.length;
    return start;
  };
  const timestamp = zipTimestamp(new Date());
  try {
    for (const source of files) {
      const info = await lstat(source.absolutePath);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      const content = await readFile(source.absolutePath);
      const compressed = deflateRawSync(content);
      const name = Buffer.from(`${archiveRoot}/${source.relativePath}`, "utf8");
      if (name.length > 0xffff || content.length > zip32Limit || compressed.length > zip32Limit) {
        throw new Error(`A project file is too large to add to the ZIP archive: ${source.relativePath}`);
      }
      const entry: CentralDirectoryEntry = {
        name,
        checksum: checksum32(content),
        compressedSize: compressed.length,
        uncompressedSize: content.length,
        localHeaderOffset: offset
      };
      await append(makeLocalHeader(entry, timestamp));
      await append(compressed);
      entries.push(entry);
    }
    const centralOffset = offset;
    for (const entry of entries) await append(makeCentralHeader(entry, timestamp));
    const centralSize = offset - centralOffset;
    await append(makeEndRecord(entries.length, centralSize, centralOffset));
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(temporaryPath, output);
  } catch (error) {
    if (!closed) await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}
