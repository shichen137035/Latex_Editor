import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { installNativeCodex, nativeCodexVersion, verifiedCodexDistribution } from "../../apps/desktop/src/main/ai/codex-native-install.js";
import { getManagedCodexExecutable } from "../../apps/desktop/src/main/ai/codex-discovery.js";
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const bytes=new TextEncoder().encode("verified fixture");const version="1.2.3-win32-x64";
const meta={name:"@openai/codex",version,dist:{tarball:"https://registry.npmjs.org/@openai/codex/-/codex-test.tgz",integrity:"sha512-"+createHash("sha512").update(bytes).digest("base64")}};
async function fixture(corrupt=false,unsafe=false){
 const root=await mkdtemp(join(tmpdir(),"texweave-codex-native-"));roots.push(root);const install=join(root,"codex-cli");
 const fetcher=vi.fn(async(input:unknown)=>String(input).endsWith("latest")?Response.json({optionalDependencies:{"@openai/codex-win32-x64":"npm:@openai/codex@"+version}}):String(input).endsWith(".tgz")?new Response(corrupt?new TextEncoder().encode("wrong"):bytes):Response.json(meta));
 const runner=vi.fn(async(exe:string,args:string[],cwd:string)=>{if(args[0]==="-tzf")return unsafe?"package/../../escape.exe":"package/package.json\npackage/vendor/x86_64-pc-windows-msvc/codex/codex.exe\n";if(args[0]==="-xzf"){const bin=join(cwd,"package/vendor/x86_64-pc-windows-msvc/codex");await mkdir(bin,{recursive:true});await writeFile(join(bin,"codex.exe"),"native");}return exe.endsWith("codex.exe")?"codex-cli 1.2.3":"";});
 return{root,install,fetcher,runner,options:{fetch:fetcher as typeof fetch,execute:runner,arch:"x64"}};
}
it("resolves the exact native platform version and rejects untrusted download metadata",()=>{
 expect(nativeCodexVersion({optionalDependencies:{"@openai/codex-win32-x64":"npm:@openai/codex@"+version}},"x64")).toBe(version);
 expect(()=>nativeCodexVersion({},"x64")).toThrow("compatible");
 for(const bad of [{...meta,name:"other"},{...meta,dist:{...meta.dist,tarball:"https://example.org/codex.tgz"}},{...meta,dist:{...meta.dist,integrity:"none"}}])expect(()=>verifiedCodexDistribution(bad,version)).toThrow("verified");
});
it("installs and discovers the verified native package without invoking Node or npm",async()=>{
 const f=await fixture();const binary=await installNativeCodex(f.install,f.options);
 expect(binary).toBe(getManagedCodexExecutable(f.install,"win32","x64"));expect(await readFile(binary,"utf8")).toBe("native");
 expect(JSON.parse(await readFile(join(f.install,".texweave-codex.json"),"utf8")).version).toBe(version);
 expect(f.runner.mock.calls.some(([exe])=>/npm|node\.exe/.test(exe))).toBe(false);
 await installNativeCodex(f.install,f.options);expect((await readdir(f.root)).sort()).toEqual(["codex-cli"]);
});
it("does not execute an archive whose integrity check fails",async()=>{const f=await fixture(true);await expect(installNativeCodex(f.install,f.options)).rejects.toThrow("checksum");expect(f.runner).not.toHaveBeenCalled();});
it("refuses archive paths outside the staging directory",async()=>{const f=await fixture(false,true);await expect(installNativeCodex(f.install,f.options)).rejects.toThrow("unexpected path");expect(f.runner.mock.calls.some(([,args])=>args[0]==="-xzf")).toBe(false);});
it("preserves an unrelated existing native directory",async()=>{const f=await fixture();await mkdir(join(f.install,"native"),{recursive:true});await writeFile(join(f.install,"native/keep.txt"),"keep");await expect(installNativeCodex(f.install,f.options)).rejects.toThrow();expect(await readFile(join(f.install,"native/keep.txt"),"utf8")).toBe("keep");});
