import { useEffect, useMemo, useRef, useState } from "react";
import type { AIChangeSet, AIConversation, AIContextSnapshotFile, AIStatus, AIModelOption, AIMode } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { useSettings } from "../settings/service.js";
import "./ai.css";

type Props = {
  projectId: string;
  projectRoot: string;
  overrides: AIContextSnapshotFile[];
  currentFile?: string;
  currentFileContent?: string;
  selectedText?: string;
  onApplyChanges(changes: AIChangeSet): Promise<void>;
  onReviewChanges?(changes: AIChangeSet[]): void;
  onOpenSettings(): void;
};

export function AIView(props: Props) {
  const api = window.latexEditor?.ai;
  const preferences = useSettings();
  const [status, setStatus] = useState<AIStatus>();
  const [copilotStatus, setCopilotStatus] = useState<AIStatus>();
  const [models, setModels] = useState<AIModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<{ conversations: AIConversation[]; changeSets: AIChangeSet[] }>({ conversations: [], changeSets: [] });
  const [activeId, setActiveId] = useState<string>();
  const [mode, setMode] = useState<AIMode>(() => preferences.global("aiDefaultMode"));
  const [executable, setExecutable] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [taskId, setTaskId] = useState<string>();
  const [includeSelection, setIncludeSelection] = useState(Boolean(props.selectedText));
  const [decisions, setDecisions] = useState<Record<string, "pending" | "accepted" | "rejected">>({});
  const [lastApplied, setLastApplied] = useState<AIChangeSet>();
  const activeIdRef = useRef(activeId);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followTranscriptRef = useRef(true);
  activeIdRef.current = activeId;
  const activeConversation = snapshot.conversations.find((item) => item.id === activeId);
  const activeMode = activeConversation?.mode ?? mode;
  const activeStatus = activeMode === "chat" ? copilotStatus : status;
  const activeChanges = useMemo(() => snapshot.changeSets.filter((item) => item.conversationId === activeId && (item.status === "pending" || item.status === "partially_accepted")), [snapshot.changeSets, activeId]);
  const latestMessageContent = activeConversation?.messages[activeConversation.messages.length - 1]?.content;

  useEffect(() => {
    if (!api) return;
    let active = true;
    const unsubscribeStatus = api.onStatus((next) => { if (active) setStatus(next); });
    const unsubscribeUpdate = api.onUpdate((update) => {
      if (!active) return;
      if (update.kind === "conversation") {
        const conversation = update.payload as AIConversation;
        setSnapshot((current) => ({ ...current, conversations: [conversation, ...current.conversations.filter((item) => item.id !== conversation.id)].sort((a, b) => b.updatedAt - a.updatedAt) }));
        if (conversation.id === activeIdRef.current && !conversation.messages.some((message) => message.status === "streaming")) setTaskId(undefined);
      } else {
        const changeSet = update.payload as AIChangeSet;
        setSnapshot((current) => ({ ...current, changeSets: [changeSet, ...current.changeSets.filter((item) => item.id !== changeSet.id)] }));
      }
    });
    void api.detect().then(async (detected) => {
      if (!active || !detected) return;
      setStatus(detected); setExecutable(detected.executablePath ?? "");
      if (detected.executablePath) void api.status().then((connected) => { if (active && connected) setStatus(connected); }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    void api.copilotStatus().then((detected) => { if (active && detected) setCopilotStatus(detected); }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; unsubscribeStatus(); unsubscribeUpdate(); };
  }, [api]);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void api.conversations(props.projectId).then((value) => {
      if (!active || !value) return;
      setSnapshot(value);
      const first = value.conversations[0];
      setActiveId(first?.id);
      if (first) setMode(first.mode);
      else setMode(preferences.global("aiDefaultMode"));
    }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; };
  }, [api, props.projectId]);

  useEffect(() => {
    if (!api || activeStatus?.auth !== "signed_in") return;
    let active = true;
    setModelsLoading(true);
    const copilot = activeMode === "chat";
    void (copilot ? api.copilotModels() : api.models()).then((available) => {
      if (!active) return;
      const next = available ?? [];
      setModels(next);
      const preferenceKey = copilot ? "aiCopilotModel" : "aiModel";
      const selected = preferences.global(preferenceKey);
      if (next.length && selected && !next.some((model) => model.id === selected)) void preferences.set(preferenceKey, "");
    }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); }).finally(() => { if (active) setModelsLoading(false); });
    return () => { active = false; };
  }, [api, preferences, activeMode, activeStatus?.auth]);

  useEffect(() => {
    if (!api || activeMode !== "chat" || copilotStatus?.auth !== "authenticating") return;
    let active = true;
    const timer = window.setInterval(() => {
      void api.copilotStatus().then((next) => {
        if (active && next) setCopilotStatus(next);
      }).catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      });
    }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [api, activeMode, copilotStatus?.auth]);

  useEffect(() => { setIncludeSelection(Boolean(props.selectedText)); }, [props.selectedText]);
  useEffect(() => { followTranscriptRef.current = true; }, [activeId]);
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript && followTranscriptRef.current) transcript.scrollTop = transcript.scrollHeight;
  }, [activeId, activeConversation?.messages.length, latestMessageContent, activeChanges.length]);
  useEffect(() => { props.onReviewChanges?.(snapshot.changeSets.filter((item) => item.status === "pending" || item.status === "partially_accepted")); }, [snapshot.changeSets, props.onReviewChanges]);
  useEffect(() => {
    const listener = (event: Event) => { const id = (event as CustomEvent<string>).detail; setLastApplied((current) => current?.id === id ? undefined : current); };
    window.addEventListener("texweave:ai-undo-complete", listener);
    return () => window.removeEventListener("texweave:ai-undo-complete", listener);
  }, []);

  const runStatus = async (action: () => Promise<AIStatus | undefined>, connectAfter = false, provider: AIMode = activeMode) => {
    setBusy(true); setError("");
    try {
      const next = await action();
      if (next) {
        if (provider === "chat") setCopilotStatus(next);
        else { setStatus(next); setExecutable(next.executablePath ?? ""); }
        if (connectAfter && next.executablePath) { const connected = await api?.status(); if (connected) setStatus(connected); }
      }
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  };

  const newConversation = async (requestedMode: AIMode) => {
    if (!api) return;
    setError("");
    try {
      const created = await api.createConversation(requestedMode, props.projectId);
      if (!created) return;
      setSnapshot((current) => ({ ...current, conversations: [created, ...current.conversations] }));
      setActiveId(created.id); setMode(requestedMode); setDraft("");
    } catch (reason) { setError(messageOf(reason)); }
  };

  const switchMode = async (requestedMode: AIMode) => {
    setMode(requestedMode);
    const matching = snapshot.conversations.find((item) => item.mode === requestedMode);
    if (matching) setActiveId(matching.id);
    else await newConversation(requestedMode);
  };

  const send = async () => {
    if (!api || !draft.trim() || taskId) return;
    setBusy(true); setError("");
    try {
      let conversation = activeConversation;
      if (!conversation) {
        conversation = await api.createConversation(activeMode, props.projectId);
        if (!conversation) throw new Error("Could not create an AI conversation.");
        setSnapshot((current) => ({ ...current, conversations: [conversation!, ...current.conversations] }));
        setActiveId(conversation.id);
      }
        const contextText = includeSelection && props.selectedText ? `Current selection in ${props.currentFile ?? "the editor"}:\n${props.selectedText}` : undefined;
      const started = await api.send({ conversationId: conversation.id, projectId: props.projectId, content: draft, ...(contextText ? { contextText } : {}), overrides: props.overrides });
      if (started) { setTaskId(started.taskId); setSnapshot((current) => ({ ...current, conversations: [started.conversation, ...current.conversations.filter((item) => item.id !== started.conversation.id)] })); }
      setDraft("");
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!api || !taskId) return;
    try { await api.cancel(taskId); } catch (reason) { setError(messageOf(reason)); }
  };

  const applyChanges = async (changeSet: AIChangeSet, decisionOverrides: Record<string, "accepted" | "rejected"> = {}) => {
    const selectedSet: AIChangeSet = {
      ...changeSet,
      files: changeSet.files.map((file) => ({ ...file, hunks: file.hunks.filter((hunk) => hunk.decision === "pending").map((hunk) => ({ ...hunk, decision: decisionOverrides[hunk.id] ?? decisions[hunk.id] ?? hunk.decision })) })).filter((file) => file.hunks.some((hunk) => hunk.decision === "accepted")),
      status: "accepted"
    };
    if (!selectedSet.files.length) { setError(t("ai.acceptOneChange")); return; }
    try {
      await props.onApplyChanges(selectedSet);
      setLastApplied(selectedSet);
      const resolvedDecisions = Object.fromEntries(changeSet.files.flatMap((file) => file.hunks.flatMap((hunk) => {
        const decision = decisionOverrides[hunk.id] ?? decisions[hunk.id] ?? hunk.decision;
        return decision === "pending" ? [] : [[hunk.id, decision] as const];
      })));
      const resolved = await api?.resolveChangeSet(changeSet.id, resolvedDecisions, true);
      if (resolved) setSnapshot((current) => ({ ...current, changeSets: current.changeSets.map((item) => item.id === resolved.id ? resolved : item) }));
      setError("");
    } catch (reason) { setError(messageOf(reason)); }
  };

  const acceptAllChanges = (changeSet: AIChangeSet) => {
    const accepted = Object.fromEntries(changeSet.files.flatMap((file) => file.hunks.filter((hunk) => hunk.decision === "pending").map((hunk) => [hunk.id, "accepted" as const])));
    void applyChanges(changeSet, accepted);
  };
  const rejectChanges = async (changeSet: AIChangeSet) => {
    const rejected = Object.fromEntries(changeSet.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, "rejected"]))) as Record<string, "rejected">;
    const resolved = await api?.resolveChangeSet(changeSet.id, rejected, false);
    if (resolved) setSnapshot((current) => ({ ...current, changeSets: current.changeSets.map((item) => item.id === resolved.id ? resolved : item) }));
  };
  const undoLastApply = () => { if (lastApplied) window.dispatchEvent(new CustomEvent("texweave:ai-undo", { detail: lastApplied })); };
  const removeConversation = async () => {
    if (!api || !activeConversation || !window.confirm(t("ai.confirmClearChat"))) return;
    try {
      await api.removeConversation(activeConversation.id);
      const conversations = snapshot.conversations.filter((item) => item.id !== activeConversation.id);
      setSnapshot((current) => ({ conversations, changeSets: current.changeSets.filter((item) => item.conversationId !== activeConversation.id) }));
      setActiveId(conversations.find((item) => item.mode === activeMode)?.id);
    } catch (reason) { setError(messageOf(reason)); }
  };

  if (!api) return null;

  return <section className="generic-sidebar ai-sidebar">
    <header className="ai-sidebar-heading"><div><span className="ai-kicker">TEXWEAVE AI</span><h2>{t("ai.title")}</h2></div><span className={`ai-status-dot ${activeStatus?.auth === "signed_in" ? "ready" : ""}`} title={t(activeStatus?.auth === "signed_in" ? "ai.signedIn" : "ai.disconnected")}/></header>
    <div className="ai-mode-switch" role="tablist"><button role="tab" aria-selected={activeMode === "chat"} className={activeMode === "chat" ? "active" : ""} onClick={() => void switchMode("chat")}>{t("ai.copilot")}</button><button role="tab" aria-selected={activeMode === "codex"} className={activeMode === "codex" ? "active" : ""} onClick={() => void switchMode("codex")}>{t("ai.codex")}</button></div>
    {!activeStatus && <div className="ai-connect-scroll"><p>{t("ai.checking")}</p></div>}
    {activeStatus && activeStatus.auth !== "signed_in" && <div className="ai-connect-scroll"><div className="ai-connect-card">
      <strong>{activeMode === "chat" ? t(activeStatus.process === "not_detected" ? "ai.copilotRequired" : "ai.copilotConnectTitle") : t(activeStatus.process === "not_detected" ? "ai.codexRequired" : activeStatus.process === "crashed" ? "ai.connectionFailed" : "ai.connectTitle")}</strong>
      <p>{activeMode === "chat" ? t(activeStatus.process === "not_detected" ? "ai.copilotRequiredHint" : "ai.copilotConnectHint") : t(activeStatus.process === "not_detected" ? "ai.codexRequiredHint" : activeStatus.process === "crashed" ? "ai.connectionFailedHint" : "ai.connectHint")}</p>
      {activeMode === "codex" && activeStatus.executablePath && <small className="ai-cli-path" title={activeStatus.executablePath}>{t("ai.cliDetected")}<br/>{activeStatus.executablePath}</small>}
      {activeMode === "codex" && (activeStatus.process === "not_detected" || activeStatus.process === "crashed") && <label className="ai-executable-field">{t("ai.executablePath")}<input value={executable} onChange={(event) => setExecutable(event.target.value)} placeholder="codex.exe" spellCheck={false}/><button disabled={busy || !executable.trim()} onClick={() => void runStatus(() => api.setExecutable(executable.trim()), true, "codex")}>{t("ai.savePath")}</button></label>}
      {activeMode === "chat" && activeStatus.process === "not_detected" && <button className="primary-button" disabled={busy} onClick={() => void runStatus(() => api.installCopilot(), false, "chat")}>{t(busy ? "ai.installingCopilot" : "ai.installCopilot")}</button>}
      {activeMode === "chat" && activeStatus.process === "running" && <button className="primary-button" disabled={busy || activeStatus.auth === "authenticating"} onClick={() => void runStatus(() => api.loginCopilot(), false, "chat")}>{t(activeStatus.auth === "authenticating" ? "ai.signingIn" : "ai.signInGitHub")}</button>}
      {activeMode === "codex" && activeStatus.process === "not_detected" && <button className="primary-button" disabled={busy} onClick={() => void runStatus(() => api.install(), true, "codex")}>{t(busy ? "ai.installing" : "ai.installCodex")}</button>}
      {activeMode === "codex" && activeStatus.process !== "not_detected" && <button className="primary-button" disabled={busy || activeStatus.process === "starting" || activeStatus.auth === "authenticating"} onClick={() => void runStatus(() => api.login(), false, "codex")}>{t(activeStatus.auth === "authenticating" ? "ai.signingIn" : "ai.signIn")}</button>}
      <button className="secondary-button ai-recheck" disabled={busy || (activeMode === "codex" && activeStatus.auth === "authenticating")} onClick={() => void runStatus(() => activeMode === "chat" ? api.copilotStatus() : api.detect(), false, activeMode)}>{t("ai.detectAgain")}</button>
    </div>{(error || activeStatus.error) && <div className="inline-error ai-error" role="alert">{error || activeStatus.error}</div>}</div>}
    {activeStatus?.auth === "signed_in" && <>
      <div className="ai-workspace-controls">
        <div className="ai-account-line"><span className="ai-avatar" aria-hidden="true">{activeMode === "chat" ? "GH" : "C"}</span><span className="ai-account-name" title={activeStatus.accountLabel ?? t("ai.signedIn")}>{activeStatus.accountLabel ?? t(activeMode === "chat" ? "ai.copilotAccount" : "ai.chatgptAccount")}</span><button className="ai-quiet-action" onClick={props.onOpenSettings}>{t("ai.settings")}</button><button className="ai-quiet-action" disabled={busy} onClick={() => void runStatus(() => activeMode === "chat" ? api.logoutCopilot() : api.logout(), false, activeMode)}>{t("ai.signOut")}</button></div>
        <label className="ai-model-picker"><span>{t("ai.model")}</span><select aria-label={t("ai.model")} value={preferences.global(activeMode === "chat" ? "aiCopilotModel" : "aiModel")} disabled={modelsLoading || Boolean(taskId)} onChange={(event) => void preferences.set(activeMode === "chat" ? "aiCopilotModel" : "aiModel", event.target.value)}><option value="">{t("ai.defaultModel")}</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name}{model.isDefault ? ` (${t("ai.recommended")})` : ""}</option>)}</select>{modelsLoading && <small>{t("ai.loadingModels")}</small>}</label>
        <div className="ai-conversation-toolbar"><select aria-label={t("ai.recentChats")} value={activeId ?? ""} onChange={(event) => { const selected = snapshot.conversations.find((item) => item.id === event.target.value); setActiveId(selected?.id); if (selected) setMode(selected.mode); }}><option value="" disabled>{t("ai.recentChats")}</option>{snapshot.conversations.filter((item) => item.mode === activeMode).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><button aria-label={t("ai.newChat")} title={t("ai.newChat")} onClick={() => void newConversation(activeMode)}>+</button><button aria-label={t("ai.clearCurrentChat")} disabled={!activeConversation || Boolean(taskId)} onClick={() => void removeConversation()} title={t("ai.clearCurrentChat")}>×</button></div>
      </div>
      <div ref={transcriptRef} className="ai-conversation-body" aria-live="polite" onScroll={(event) => { const element = event.currentTarget; followTranscriptRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
        <div className="ai-message-list">{activeConversation?.messages.map((message) => <article key={message.id} className={`ai-message ${message.role} ${message.status ?? ""}`}><small>{message.role === "user" ? t("ai.you") : message.role === "assistant" ? t("ai.assistant") : message.role}</small><div className="ai-message-content">{message.content || (message.status === "streaming" ? t("ai.thinking") : "")}</div></article>)}{!activeConversation?.messages.length && <p className="ai-empty-chat">{t(activeMode === "chat" ? "ai.chatReady" : "ai.codexReady")}</p>}</div>
        {lastApplied && <div className="ai-undo-row"><span>{t("ai.changesApplied")}</span><button onClick={undoLastApply}>{t("ai.undoChanges")}</button></div>}
        {activeChanges.map((changeSet) => <section className="ai-change-set" key={changeSet.id}><header><strong>{t("ai.proposedChanges", { count: changeSet.files.length })}</strong><div><button onClick={() => acceptAllChanges(changeSet)}>{t("ai.acceptAll")}</button><button onClick={() => void rejectChanges(changeSet)}>{t("ai.rejectAll")}</button><button disabled={!changeSet.files.some((file) => file.hunks.some((hunk) => hunk.decision === "pending" && (decisions[hunk.id] ?? "pending") === "accepted"))} onClick={() => void applyChanges(changeSet)}>{t("ai.applyAccepted")}</button></div></header>{changeSet.files.map((file) => <div className="ai-file-change" key={file.path}><strong>{file.type.toUpperCase()} · {file.path}</strong>{file.hunks.map((hunk) => <div className="ai-hunk" key={hunk.id}><pre className="old">{hunk.oldText || "—"}</pre><pre className="new">{hunk.newText || "—"}</pre><div><button disabled={hunk.decision !== "pending"} className={decisions[hunk.id] === "accepted" || hunk.decision === "accepted" ? "selected" : ""} onClick={() => setDecisions((value) => ({ ...value, [hunk.id]: "accepted" }))}>{t("ai.accept")}</button><button disabled={hunk.decision !== "pending"} className={decisions[hunk.id] === "rejected" || hunk.decision === "rejected" ? "selected" : ""} onClick={() => setDecisions((value) => ({ ...value, [hunk.id]: "rejected" }))}>{t("ai.reject")}</button></div></div>)}</div>)}</section>)}
      </div>
      <footer className="ai-composer-dock">
        {props.selectedText && <div className="ai-context-options"><label><input type="checkbox" checked={includeSelection} onChange={(event) => setIncludeSelection(event.target.checked)}/>{t("ai.includeSelection")}</label></div>}
        {(error || activeStatus.error) && <div className="inline-error ai-error" role="alert">{error || activeStatus.error}</div>}
        <div className="ai-composer"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={t("ai.messagePlaceholder")} aria-label={t("ai.messagePlaceholder")}/>{taskId ? <button className="secondary-button" onClick={() => void cancel()}>{t("ai.stop")}</button> : <button className="primary-button" disabled={busy || !draft.trim()} onClick={() => void send()}>{t("ai.send")}</button>}</div>
      </footer>
    </>}
  </section>;
}

function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
