import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";

export interface RecorderDependencies { inputs: string[]; modifiedAt: number }

/** Read TeX's actual file inputs, retaining only paths inside the project. */
export async function readRecorderDependencies(root: string, mainFile: string, args: string[], isolated = false): Promise<RecorderDependencies | undefined> {
  const sourcePath = resolve(root, mainFile);
  const jobName = basename(sourcePath, extname(sourcePath));
  const readDirectory = (flags: string[]): string | undefined => {
    for (let index = 0; index < args.length; index++) {
      const argument = args[index]!;
      const inline = flags.find(flag => argument.toLowerCase().startsWith(`${flag}=`));
      if (inline) return argument.slice(inline.length + 1);
      if (flags.some(flag => argument.toLowerCase() === flag) && args[index + 1]) return args[index + 1];
    }
    return undefined;
  };
  const output = readDirectory(["-outdir", "--outdir", "-output-directory", "--output-directory"]);
  const auxiliary = readDirectory(["-auxdir", "--auxdir", "-aux-directory", "--aux-directory"]);
  const directories = [...(auxiliary ? [resolve(root, auxiliary)] : []), ...(output ? [resolve(root, output)] : []), ...(isolated ? [] : [dirname(sourcePath), root])];
  for (const directory of [...new Set(directories)]) {
    const path = resolve(directory, `${jobName}.fls`);
    let contents: string, modifiedAt: number;
    try { contents = await readFile(path, "utf8"); modifiedAt = (await stat(path)).mtimeMs; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    const inputs = new Set<string>();
    const workingDirectory = contents.split(/\r?\n/).find(line => line.startsWith("PWD "))?.slice(4).trim() || root;
    for (const line of contents.split(/\r?\n/)) {
      if (!line.startsWith("INPUT ")) continue;
      const input = line.slice(6).trim();
      if (!input) continue;
      const absolute = isAbsolute(input) ? resolve(input) : resolve(workingDirectory, input);
      const local = relative(root, absolute);
      if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) continue;
      inputs.add(local.split(sep).join("/"));
    }
    return { inputs: [...inputs].sort(), modifiedAt };
  }
  return undefined;
}

export async function readRecorderInputs(root: string, mainFile: string, args: string[], isolated = false): Promise<string[]> {
  return (await readRecorderDependencies(root, mainFile, args, isolated))?.inputs ?? [];
}
