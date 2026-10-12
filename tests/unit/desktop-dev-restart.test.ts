import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const { runtimeBuildFingerprint } = createRequire(import.meta.url)("../../apps/desktop/scripts/runtime-build-state.cjs") as { runtimeBuildFingerprint(root: string, config: string): string };

it("only restarts for runnable output changes, including referenced runtime packages", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-dev-restart-"));
  try {
    await mkdir(join(root, "app/dist"), { recursive: true });
    await mkdir(join(root, "package/dist"), { recursive: true });
    await mkdir(join(root, "renderer/dist"), { recursive: true });
    const config = join(root, "app/tsconfig.json");
    await writeFile(config, JSON.stringify({ compilerOptions: { outDir: "dist" }, references: [{ path: "../package" }] }));
    await writeFile(join(root, "package/tsconfig.json"), JSON.stringify({ compilerOptions: { outDir: "dist" } }));
    await writeFile(join(root, "app/dist/main.js"), "original main");
    await writeFile(join(root, "package/dist/index.cjs"), "original dependency");
    const original = runtimeBuildFingerprint(root, config);
    // A type check may rewrite declarations, source maps and build metadata,
    // or re-emit identical JS. Renderer changes belong to Vite's own HMR.
    await writeFile(join(root, "app/dist/main.js"), "original main");
    await writeFile(join(root, "package/dist/index.d.ts"), "changed types");
    await writeFile(join(root, "package/dist/index.cjs.map"), "changed map");
    await writeFile(join(root, "package/dist/tsconfig.tsbuildinfo"), "changed metadata");
    await writeFile(join(root, "renderer/dist/index.js"), "changed renderer");
    expect(runtimeBuildFingerprint(root, config)).toBe(original);
    await writeFile(join(root, "package/dist/index.cjs"), "changed dependency");
    expect(runtimeBuildFingerprint(root, config)).not.toBe(original);
    await writeFile(join(root, "package/dist/index.cjs"), "original dependency");
    expect(runtimeBuildFingerprint(root, config)).toBe(original);
    await writeFile(join(root, "app/dist/main.js"), "changed main");
    expect(runtimeBuildFingerprint(root, config)).not.toBe(original);
  } finally { await rm(root, { recursive: true, force: true }); }
});
