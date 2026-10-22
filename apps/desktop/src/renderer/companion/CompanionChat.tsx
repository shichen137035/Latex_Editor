import { AIApprovalCard } from "../ai/AIApprovalCard.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AIApprovalRequest, AIConversation, AIStatus, AIModelOption, AIMode } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { useSettings } from "../settings/service.js";
import { AIMessageContent } from "../ai/AIMessageContent.js";
import { AIResponse } from "../ai/AIResponse.js";
import { ReasoningEffortPicker } from "../ai/ReasoningEffortPicker.js";
import { mergeConversation } from "../ai/conversationState.js";
import { readAIDraft, writeAIDraft } from "../ai/draftStorage.js";

type Props = { onOpenSettings(): void };
const draftKey = "companion:global";

export function CompanionChat({ onOpenSettings }: Props) {
  const api = window.latexEditor?.companionChat;
  const providers = window.latexEditor?.aiProviders;
  const store = useSettings();
  const [mode, setMode] = useState<AIMode>(() => store.global("companionProvider"));
  const [codexStatus, setCodexStatus] = useState<AIStatus>();
  const [copilotStatus, setCopilotStatus] = useState<AIStatus>();
  const [models, setModels] = useState<AIModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [draft, setDraft] = useState(() => readAIDraft(draftKey) || readAIDraft("companion:home"));
  const [approvals, setApprovals] = useState<AIApprovalRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const active = conversations.find(item => item.id === activeId);
  const status = mode === "chat" ? copilotStatus : codexStatus;
  const modelPreference = mode === "chat" ? "aiCopilotModel" : "aiModel";
  const effortPreference = mode === "chat" ? "aiCopilotReasoningEffort" : "aiReasoningEffort";
  const selectedModelId = store.global(modelPreference);
  const selectedModel = selectedModelId ? models.find(item => item.id === selectedModelId) : models.find(item => item.isDefault);
  const preferredEffort = store.global(effortPreference);
  const selectedEffort = selectedModel?.supportedReasoningEfforts?.some(item => item.effort === preferredEffort) ? preferredEffort : "";
  const running = Boolean(active?.activeTaskId || active?.messages.some(item => item.status === "streaming"));
  const modeConversations = useMemo(() => conversations.filter(item => item.mode === mode), [conversations, mode]);
  const upsert = useCallback((incoming: AIConversation) => setConversations(existing => {
    const current = existing.find(item => item.id === incoming.id);
    return [current ? mergeConversation(current, incoming) : incoming, ...existing.filter(item => item.id !== incoming.id)].sort((a, b) => b.updatedAt - a.updatedAt);
  }), []);

  const refreshStatus = useCallback(async () => {
    if (!providers) return;
    const [codex, copilot] = await Promise.allSettled([providers.status(), providers.copilotStatus()]);
    if (codex.status === "fulfilled" && codex.value) setCodexStatus(codex.value);
    if (copilot.status === "fulfilled" && copilot.value) setCopilotStatus(copilot.value);
  }, [providers]);

  useEffect(() => {
    void refreshStatus();
    const unsubscribe = providers?.onStatus(setCodexStatus);
    const timer = window.setInterval(() => void refreshStatus(), 5000);
    return () => { window.clearInterval(timer); unsubscribe?.(); };
  }, [refreshStatus, providers]);

  useEffect(() => {
    if (!providers || status?.auth !== "signed_in") { setModels([]); setModelsLoading(false); return; }
    let current = true;
    setModels([]); setModelsLoading(true);
    void (mode === "chat" ? providers.copilotModels() : providers.models()).then(async available => {
      if (!current) return;
      const next = available ?? [];
      setModels(next);
      if (selectedModelId && next.length && !next.some(item => item.id === selectedModelId)) await store.set(modelPreference, "");
    }).catch(reason => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (current) setModelsLoading(false); });
    return () => { current = false; };
  }, [providers, mode, status?.auth]);

  useEffect(() => {
    let current = true;
    setConversations([]);
    setActiveId(undefined);
    if (!api) return;
    void api.conversations().then(value => {
      if (!current || !value) return;
      setConversations(existing => [...existing, ...value.filter(item => !existing.some(current => current.id === item.id))].sort((a, b) => b.updatedAt - a.updatedAt));
      setActiveId(id => id ?? value.find(item => item.mode === modeRef.current)?.id);
    }).catch(reason => { if (current) setError(String(reason)); });
    void api.approvals().then(value => { if (current) setApprovals(value); }).catch(reason => { if (current) setError(String(reason)); });
    const unsubscribe = api.onUpdate(update => {
      if (!current) return;
      if (update.kind === "approval") {
        const approval = update.payload;
        setApprovals(existing => [...existing.filter(item => item.id !== approval.id), ...(approval.status === "pending" ? [approval] : [])]);
        return;
      }
      const incoming = update.payload;
      upsert(incoming);
    });
    return () => { current = false; unsubscribe(); };
  }, [api, upsert]);

  useEffect(() => {
    writeAIDraft(draftKey, draft);
  }, [draft]);
  useEffect(() => { writeAIDraft("companion:home", ""); }, []);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight; }, [active?.messages.length, active?.messages.at(-1)?.content]);

  const selectMode = async (next: AIMode) => {
    if (busy || running) return;
    setMode(next); setError("");
    setBusy(true);
    try {
      await store.set("companionProvider", next);
      setActiveId(conversations.find(item => item.mode === next)?.id);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };

  const newConversation = async () => {
    if (!api || busy || running) return;
    setBusy(true); setError("");
    try { const created = await api.createConversation(mode); upsert(created); setActiveId(created.id); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };

  const signIn = async () => {
    if (!providers) return;
    setChecking(true); setError("");
    try {
      const next = mode === "chat" ? await providers.loginCopilot() : await providers.login();
      if (next) { if (mode === "chat") setCopilotStatus(next); else setCodexStatus(next); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setChecking(false); void refreshStatus(); }
  };

  const install = async () => {
    if (!providers) return;
    setChecking(true); setError("");
    try {
      const next = mode === "chat" ? await providers.installCopilot() : await providers.install();
      if (next) { if (mode === "chat") setCopilotStatus(next); else setCodexStatus(next); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setChecking(false); void refreshStatus(); }
  };

  const signOut = async () => {
    if (!providers) return;
    setChecking(true); setError("");
    try {
      const next = mode === "chat" ? await providers.logoutCopilot() : await providers.logout();
      if (next) { if (mode === "chat") setCopilotStatus(next); else setCodexStatus(next); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setChecking(false); void refreshStatus(); }
  };

  const send = async () => {
    if (!api || !draft.trim() || busy || running || status?.auth !== "signed_in") return;
    setBusy(true); setError("");
    const submitted = draft;
    try {
      let conversation = active?.mode === mode ? active : undefined;
      if (!conversation) {
        conversation = await api.createConversation(mode);
        if (!conversation) throw new Error(t("ui.AIView.could_not_create_an_ai_conversation"));
        upsert(conversation); setActiveId(conversation.id);
      }
      const started = await api.send({ conversationId: conversation.id, content: submitted.trim() });
      if (started) {
        upsert(started.conversation);
        setActiveId(started.conversation.id);
        setDraft(current => current === submitted ? "" : current);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const stop = async () => {
    if (!active?.activeTaskId || !api) return;
    try { await api.cancel(active.activeTaskId); } catch (reason) { setError(String(reason)); }
  };

  const resolveApproval = async (id: string, allow: boolean) => {
    try { await api?.resolveApproval(id, allow); } catch (reason) { setError(String(reason)); }
  };

  return <div className="companion-chat">
    <div className="companion-chat-toolbar">
      <select aria-label={t("helpDetail.ai.provider")} value={mode} disabled={checking || busy || running} onChange={event => void selectMode(event.target.value as AIMode)}>
        <option value="chat">{t("ai.copilot")}</option><option value="codex">{t("ai.codex")}</option>
      </select>
      {modeConversations.length > 0 && <select aria-label={t("ai.history.manage")} value={active?.mode === mode ? active.id : ""} disabled={busy || running} onChange={event => setActiveId(event.target.value)}>
        {modeConversations.map(item => <option key={item.id} value={item.id}>{item.title === "New chat" ? t("ai.newChat") : item.title}</option>)}
      </select>}
      <button type="button" aria-label={t("ai.newChat")} title={t("ai.newChat")} disabled={busy || running} onClick={() => void newConversation()}>＋</button>
      <button type="button" aria-label={t("activity.settings")} title={t("activity.settings")} onClick={onOpenSettings}>⚙</button>
    </div>
    {status?.auth === "signed_in" && <div className="companion-model-controls">
      <select aria-label={t("ai.model")} title={t("ai.model")} value={selectedModelId} disabled={modelsLoading || busy || running} onChange={event => void store.set(modelPreference, event.target.value)}>
        <option value="">{t(modelsLoading ? "ai.loadingModels" : "ai.defaultModel")}</option>
        {models.map(model => <option key={model.id} value={model.id}>{model.name}{model.isDefault ? ` (${t("ai.recommended")})` : ""}</option>)}
      </select>
      <ReasoningEffortPicker value={selectedEffort} defaultEffort={selectedModel?.defaultReasoningEffort} efforts={selectedModel?.supportedReasoningEfforts ?? []} modelName={selectedModel?.name ?? t("ai.defaultModel")} disabled={modelsLoading || busy || running} onChange={effort => void store.set(effortPreference, effort)}/>
    </div>}
    {status?.auth === "signed_in" ? <div className="companion-account"><span className="ai-status-dot ready"/><span>{status.accountLabel ?? t("ai.signedIn")}</span><button type="button" disabled={checking || running} onClick={() => void signOut()}>{t("ai.signOut")}</button></div> : <div className="companion-connect">
      <strong>{status?.auth === "authenticating" ? t("ai.signingIn") : mode === "chat" ? t("ai.copilotConnectTitle") : t("ai.connectTitle")}</strong>
      <p>{status?.error ?? t(status?.process === "not_detected" ? mode === "chat" ? "ai.copilotRequiredHint" : "ai.codexRequiredHint" : "companion.preview")}</p>
      {status?.process === "not_detected" ? <button type="button" className="primary-button" disabled={checking} onClick={() => void install()}>{t(mode === "chat" ? "ai.installCopilot" : "ai.installCodex")}</button> : <button type="button" className="primary-button" disabled={checking || !status || status.auth === "authenticating"} onClick={() => void signIn()}>{t(mode === "chat" ? "ai.signInGitHub" : "ai.signIn")}</button>}
    </div>}
      <div className="companion-chat-history" ref={bodyRef} aria-live="polite">
        {active?.messages.map(message => <article className={`companion-message companion-message-${message.role}`} key={message.id}>
          <strong>{message.role === "user" ? t("ai.you") : message.role === "assistant" ? (mode === "chat" ? t("ai.copilot") : t("ai.codex")) : message.role}</strong>
          {message.role === "assistant" ? <AIResponse message={message} projectRoot=""/> : <AIMessageContent content={message.content} projectRoot=""/>}
        </article>)}
        {!active?.messages.length && <p className="companion-chat-empty">{t("companion.chatWelcome")}</p>}
      </div>
      {error && <div className="inline-error" role="alert">{error}</div>}
        {approvals.filter(request => request.conversationId === activeId).map(request => <AIApprovalCard key={request.id} request={request} onResolve={resolveApproval}/>)}
      <form className="companion-chat-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
        <textarea aria-label={t("ai.messagePlaceholder")} placeholder={t("ai.messagePlaceholder")} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (!event.nativeEvent.isComposing && event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
        {running ? <button type="button" onClick={() => void stop()}>{t("ai.stop")}</button> : <button type="submit" disabled={busy || !draft.trim() || status?.auth !== "signed_in"}>{t("ai.send")}</button>}
      </form>
  </div>;
}
