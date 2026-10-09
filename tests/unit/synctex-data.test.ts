import { mkdtemp, mkdir, rmdir, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { findSyncTexData } from "../../packages/compiler-latexmk/src/synctex-data.js";

it("requires a nonempty sidecar from the same build, including auxiliary directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-synctex-")), aux = join(root, "aux");
  const pdf = join(root, "main.pdf"), data = join(aux, "main.synctex.gz");
  try {
    await mkdir(aux);
    await writeFile(pdf, "pdf");
    expect((await findSyncTexData(pdf, [aux])).state).toBe("missing");
    await writeFile(data, "");
    expect((await findSyncTexData(pdf, [aux])).state).toBe("missing");
    await writeFile(data, "synctex");
    expect(await findSyncTexData(pdf, [aux])).toMatchObject({ state: "ready", directory: aux });
    await utimes(data, new Date(0), new Date(0));
    expect((await findSyncTexData(pdf, [aux])).state).toBe("stale");
  } finally {
    await unlink(data).catch(() => undefined);
    await unlink(pdf).catch(() => undefined);
    await rmdir(aux).catch(() => undefined);
    await rmdir(root);
  }
});
