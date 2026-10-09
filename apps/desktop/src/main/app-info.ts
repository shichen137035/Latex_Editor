import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DesktopAppInfo } from "@latex-editor/contracts/desktop-ipc";

/** The root package is the authority for both development and packaged builds. */
export async function readAppInfo(packagePath = resolve(__dirname, "../../../../package.json")): Promise<DesktopAppInfo> {
  const metadata: unknown = JSON.parse(await readFile(packagePath, "utf8"));
  const version = metadata && typeof metadata === "object" && "version" in metadata ? metadata.version : undefined;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:\.\d+)?(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) {
    throw new Error("Root package.json must contain an application version");
  }
  return { version };
}
