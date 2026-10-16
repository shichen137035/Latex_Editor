import { useEffect, useState } from "react";
import type { AIStatus } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
export function CodexEnvironmentSettings() {
  const [status,setStatus]=useState<AIStatus>();const [path,setPath]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{let active=true;const api=window.latexEditor!.ai;const unsubscribe=api.onStatus(value=>{if(active)setStatus(value);});
    void api.detect().then(value=>{if(active&&value){setStatus(value);setPath(value.executablePath??"");}}).catch(reason=>{if(active)setError(String(reason));});
    return()=>{active=false;unsubscribe();};},[]);
  const run=async(action:()=>Promise<AIStatus|undefined>)=>{setBusy(true);setError("");try{const next=await action();if(next){setStatus(next);setPath(next.executablePath??"");}}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}finally{setBusy(false);}};
  const disabled=busy||status?.process==="starting";
  return <section className="codex-environment-settings" data-codex-environment><h3>{t("ai.environmentTitle")}</h3><p>{t("ai.environmentHint")}</p>
    <p role="status">{t(status?.executablePath?"settings.found":"settings.notFound")}{status?.executablePath&&<code>{status.executablePath}</code>}</p>
    <label htmlFor="codex-environment-path">{t("ai.executablePath")}</label><div className="toolchain-install-directory"><input id="codex-environment-path" value={path} disabled={disabled} onChange={event=>setPath(event.target.value)} placeholder="codex.exe" spellCheck={false}/><button disabled={disabled||!path.trim()} onClick={()=>void run(()=>window.latexEditor!.ai.setExecutable(path.trim()))}>{t("ai.savePath")}</button></div>
    <div className="toolchain-install-actions"><button data-codex-install disabled={disabled} onClick={()=>void run(()=>window.latexEditor!.ai.install(Boolean(status?.executablePath)))}>{t(disabled?"ai.installing":status?.executablePath?"ai.repairEnvironment":"ai.installCodex")}</button><button disabled={disabled} onClick={()=>void run(()=>window.latexEditor!.ai.detect())}>{t("ai.detectAgain")}</button></div>
    {(error||status?.error)&&<p role="alert">{error||status?.error}</p>}
  </section>;
}
