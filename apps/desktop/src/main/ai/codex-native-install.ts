import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rename, rm, lstat, open } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { codexPackageExecutable } from "./codex-discovery.js";

type Execute = (executable: string, args: string[], cwd: string) => Promise<string>;
const execute: Execute = (executable,args,cwd) => new Promise((resolve,reject) => {
  const child=spawn(executable,args,{cwd,shell:false,windowsHide:true,stdio:["ignore","pipe","pipe"]});let output="";
  const timer=setTimeout(()=>{child.kill();reject(new Error("Codex installation command timed out."));},120000);
  const capture=(chunk:Buffer)=>{output=(output+chunk.toString()).slice(-1024*1024);};child.stdout.on("data",capture);child.stderr.on("data",capture);
  child.once("error",error=>{clearTimeout(timer);reject(error);});child.once("close",code=>{clearTimeout(timer);if(code===0)resolve(output);else reject(new Error(`Codex installation command failed (${code}). ${output.slice(-2000)}`));});
});
export function nativeCodexVersion(metadata: unknown, arch: string): string {
  const alias=(metadata as {optionalDependencies?:Record<string,string>})?.optionalDependencies?.[`@openai/codex-win32-${arch}`];
  const match=/^npm:@openai\/codex@(\d+\.\d+\.\d+-win32-(?:x64|arm64))$/.exec(alias??"");
  if(!match || !match[1]!.endsWith("-"+arch))throw new Error("The official Codex package has no compatible Windows build.");return match[1]!;
}
export function verifiedCodexDistribution(metadata: unknown, version: string): {url:string;integrity:string} {
  const item=metadata as {name?:string;version?:string;dist?:{tarball?:string;integrity?:string}};
  const url=item?.dist?.tarball,integrity=item?.dist?.integrity;
  if(item?.name!=="@openai/codex"||item.version!==version||typeof url!=="string"||!url.startsWith("https://registry.npmjs.org/@openai/codex/-/codex-")||!/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity??""))throw new Error("The official Codex download metadata could not be verified.");
  return {url,integrity:integrity!};
}
export async function installNativeCodex(installRoot: string, options: {fetch?:typeof fetch;execute?:Execute;arch?:string}={}): Promise<string> {
  const arch=options.arch??process.arch;if(!["x64","arm64"].includes(arch))throw new Error("Codex automatic installation supports Windows x64 and ARM64.");
  const fetcher=options.fetch??globalThis.fetch,run=options.execute??execute;
  const json=async(url:string)=>{const response=await fetcher(url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error(`Codex metadata download failed (HTTP ${response.status}).`);return response.json() as Promise<unknown>;};
  const version=nativeCodexVersion(await json("https://registry.npmjs.org/@openai%2fcodex/latest"),arch);
  const asset=verifiedCodexDistribution(await json(`https://registry.npmjs.org/@openai%2fcodex/${version}`),version);
  await mkdir(dirname(installRoot),{recursive:true});
  if(existsSync(installRoot)&&(await lstat(installRoot)).isSymbolicLink())throw new Error("The Codex installation folder cannot be a junction or symbolic link.");
  await mkdir(installRoot,{recursive:true});
  const staging=await mkdtemp(join(dirname(installRoot),".codex-install-"));
  const destination=join(installRoot,"native"),backup=join(staging,"previous");let replaced=false;
  try {
    const response=await fetcher(asset.url,{signal:AbortSignal.timeout(10*60*1000)});if(!response.ok||!response.body)throw new Error(`Codex download failed (HTTP ${response.status}).`);
    const archive=join(staging,"codex.tgz"),handle=await open(archive,"wx"),hash=createHash("sha512"),reader=response.body.getReader();let bytes=0;
    try {for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>512*1024*1024)throw new Error("Codex download exceeded the size limit.");hash.update(value);await handle.writeFile(value);}}
    finally {await reader.cancel().catch(()=>undefined);reader.releaseLock();await handle.close();}
    if("sha512-"+hash.digest("base64")!==asset.integrity)throw new Error("Codex download checksum verification failed.");
    const tar=join(process.env.SystemRoot??"C:\\Windows","System32","tar.exe");
    const entries=await run(tar,["-tzf",archive],staging);
    if(!entries.trim()||entries.split(/\r?\n/).filter(Boolean).some(name=>!/^package(?:\/|$)/.test(name)||name.split(/[\\/]/).includes("..")||name.includes("\\")))throw new Error("The Codex archive contains an unexpected path.");
    await run(tar,["-xzf",archive],staging);
    const source=join(staging,"package"),binary=codexPackageExecutable(source,"win32",arch);
    if(!binary)throw new Error("The Codex archive has no native executable.");
    const versionOutput=await run(binary,["--version"],source);if(!/codex/i.test(versionOutput))throw new Error("The downloaded Codex executable did not pass its version check.");
    if(existsSync(destination)) {
      const marker=JSON.parse(await readFile(join(installRoot,".texweave-codex.json"),"utf8"));
      if(marker.schemaVersion!==1||marker.package!=="@openai/codex"||(await lstat(destination)).isSymbolicLink())throw new Error("The existing native Codex folder is not managed by TeXWeave.");
      await rename(destination,backup);replaced=true;
    }
    try {await rename(source,destination);}catch(error){if(replaced)await rename(backup,destination);throw error;}
    const installed=codexPackageExecutable(destination,"win32",arch);if(!installed)throw new Error("The installed Codex executable is missing.");
    await writeFile(join(installRoot,".texweave-codex.json"),JSON.stringify({schemaVersion:1,package:"@openai/codex",version,integrity:asset.integrity},null,2));
    return installed;
  } finally {await rm(staging,{recursive:true,force:true,maxRetries:3});}
}
