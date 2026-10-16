import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { LatexmkCompilerService, type MissingPackageRepair } from "../../packages/compiler-latexmk/src/index.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root,{recursive:true,force:true}))); });
async function fixture(repair?: MissingPackageRepair, missing="caption.sty") {
  const root = await mkdtemp(join(tmpdir(),"texweave-compile-repair-"));roots.push(root);
  await writeFile(join(root,"main.tex"),"\\documentclass{article}\n\\begin{document}test\\end{document}");
  const script = join(root,"compiler.cjs");
  await writeFile(script, `const fs=require('node:fs'); fs.appendFileSync('attempts.txt','1');
if(!fs.existsSync('installed')){fs.writeFileSync('main.log',"! LaTeX Error: File '${missing}' not found.\\nl.2 test\\n");process.exit(1);}
fs.writeFileSync('main.log','');fs.writeFileSync('main.pdf','%PDF-1.7 test');fs.writeFileSync('arguments.json',JSON.stringify(process.argv));`);
  const compiler = new LatexmkCompilerService({projects:{} as never,files:{} as never,profiles:{getCompilerProfile:()=>({id:"fixture",executable:process.execPath,arguments:[script],timeoutMs:10000})},clock:{now:()=>new Date()},ids:{next:()=>"00000000-0000-4000-8000-000000000001"},...(repair ? {repairMissingPackages:repair}: {})});
  return {root,compiler,compile:()=>compiler.compileWorkspace({workspaceRoot:root,mainFile:"main.tex"})};
}
it("retries compilation with -g after a successful repair and retains the install log", async () => {
  let root="";
  const repair = vi.fn<MissingPackageRepair>(async request=>{expect(request.files).toEqual(["caption.sty"]);request.output("installed caption");await writeFile(join(root,"installed"),"yes");return true;});
  const f=await fixture(repair);root=f.root;
  const result=await f.compile();expect(result.status).toBe("succeeded");expect(repair).toHaveBeenCalledOnce();
  expect(await readFile(join(root,"attempts.txt"),"utf8")).toBe("11");
  expect(JSON.parse(await readFile(join(root,"arguments.json"),"utf8"))).toContain("-g");
  expect(await readFile(result.logPath!,"utf8")).toContain("installed caption");
});
it("does not retry without the feature, when disabled, or for missing local source files", async () => {
  const disabled=vi.fn<MissingPackageRepair>(async()=>false);const f=await fixture(disabled);
  expect((await f.compile()).status).toBe("failed");expect(await readFile(join(f.root,"attempts.txt"),"utf8")).toBe("1");
  const repair=vi.fn<MissingPackageRepair>(async()=>true);const local=await fixture(repair,"chapter.tex");
  expect((await local.compile()).status).toBe("failed");expect(repair).not.toHaveBeenCalled();
  const absent=await fixture();expect((await absent.compile()).status).toBe("failed");
});
it("stops when the same missing file remains instead of repeatedly downloading it", async () => {
  const repair=vi.fn<MissingPackageRepair>(async()=>true);const f=await fixture(repair);
  expect((await f.compile()).status).toBe("failed");expect(repair).toHaveBeenCalledOnce();
});
it("retains original missing-file diagnostics when package installation fails", async () => {
  const f=await fixture(async()=>{throw new Error("Permission denied for tlmgr");});
  const result=await f.compile();expect(result.status).toBe("failed");
  expect(result.diagnostics.some(d=>d.code==="MISSING_FILE")).toBe(true);
  expect(result.diagnostics.find(d=>d.code==="PACKAGE_INSTALL_FAILED")?.message).toContain("Permission denied");
});
it("cancels during package repair without starting a second compilation", async () => {
  let started=false;
  const f=await fixture(async request=>{started=true;await new Promise<void>((_resolve,reject)=>request.signal.addEventListener("abort",()=>reject(new Error("cancelled")),{once:true}));return true;});
  const result=f.compile();await vi.waitFor(()=>expect(started).toBe(true));
  expect((await f.compiler.cancel("00000000-0000-4000-8000-000000000001")).cancelled).toBe(true);
  expect((await result).status).toBe("cancelled");expect(await readFile(join(f.root,"attempts.txt"),"utf8")).toBe("1");
});

it("does not mistake a network connection abort for user cancellation", async () => {
  const f=await fixture(async()=>{throw new Error("Network connection aborted");});
  const result=await f.compile();expect(result.status).toBe("failed");expect(result.diagnostics.some(d=>d.code==="PACKAGE_INSTALL_FAILED")).toBe(true);
});
