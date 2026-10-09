import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readAppInfo } from "../../apps/desktop/src/main/app-info.js";

describe("application version authority", () => {
  it("uses the repository package version", async () => {
    const metadata = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    expect(await readAppInfo()).toEqual({ version: metadata.version });
  });
  it("reads updates without a cached renderer constant and rejects missing versions", async () => {
    const root = await mkdtemp(join(tmpdir(), "texweave-version-"));
    const path = join(root, "package.json");
    try {
      for (const version of ["0.6.5", "0.6.5.1", "0.7.0-beta.1"]) {
        await writeFile(path, JSON.stringify({ version }));
        expect((await readAppInfo(path)).version).toBe(version);
      }
      for (const version of [undefined, null, 38, "", "not-a-version"]) {
        await writeFile(path, JSON.stringify({ version }));
        await expect(readAppInfo(path)).rejects.toThrow("application version");
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
