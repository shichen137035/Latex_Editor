import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent } from "react";
import { createPortal } from "react-dom";
import type { AIChangeSet, AIConversation, AIContextSnapshotFile, AIStatus, AIModelOption, AIMode } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { useSettings } from "../settings/service.js";
import { ConversationPicker } from "./ConversationPicker.js";
import { AIMessageContent } from "./AIMessageContent.js";
import { AIResponse } from "./AIResponse.js";
import "./ai.css";
import type { AIApprovalRequest } from "@latex-editor/contracts";
import { PermissionPicker } from "./PermissionPicker.js";
import { ChangesCard } from "./ChangesCard.js";
import type { AIApplyResult } from "./changeOperations.js";
import { ReasoningEffortPicker } from "./ReasoningEffortPicker.js";
import type { MathContext } from "../math/types.js";
import { newestConversation } from "./conversationState.js";
import { useAttachmentDraft } from "./attachmentDraft.js";

const AI_LONG_INPUT_THRESHOLD = 12_000;
const AI_COMPOSER_HEIGHT_RATIO = 2.5;

type Props = {
  projectId: string;
  projectRoot: string;
  mathContext?: MathContext;
  overrides: AIContextSnapshotFile[];
  currentFile?: string;
  currentFileContent?: string;
  selectedText?: string;
  onApplyChanges(changes: AIChangeSet, hunkIds: string[]): Promise<AIApplyResult>;
  onUndoChanges(changes: AIChangeSet, hunkIds: string[]): Promise<void>;
  onViewChanges(changes: AIChangeSet, path: string): void;
  onReviewChanges?(changes: AIChangeSet[]): void;
  onOpenSettings(): void;
  onOpenFile?(path: string, line?: number): void;
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
  const [notice, setNotice] = useState("");
  // Keep native typing outside transcript renders; publish only changes needed by composer controls.
  const draftRef = useRef("");
  const [draftSummary, setDraftSummary] = useState({ hasText: false, long: false });
  const [editingMessageId, setEditingMessageId] = useState<string>();
  const [editedContent, setEditedContent] = useState("");
  const { client: attachmentDraft, attachments, loading: attachmentsLoading } = useAttachmentDraft(api, props.projectId, activeId, reason => setError(messageOf(reason)));
  const [sending, setSending] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const composerExpandedRef = useRef(false);
  composerExpandedRef.current = composerExpanded;
  const composerCaret = useRef<{ start: number; end: number; scrollTop: number } | undefined>(undefined);
  const longDraftFileRef = useRef<{ content: string; path: string } | undefined>(undefined);
  const [taskId, setTaskId] = useState<string>();
  const [canceling, setCanceling] = useState(false);
  const [includeSelection, setIncludeSelection] = useState(Boolean(props.selectedText));
  const [changesBusy, setChangesBusy] = useState(false);
  const [approvals, setApprovals] = useState<AIApprovalRequest[]>([]);
  const [historyDeleting, setHistoryDeleting] = useState(false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const activeIdRef = useRef(activeId);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const activeTaskIdRef = useRef<string | undefined>(undefined);
  const followTranscriptRef = useRef(true);
  const [transcriptAtBottom, setTranscriptAtBottom] = useState(true);
  activeIdRef.current = activeId;
  const activeConversation = snapshot.conversations.find((item) => item.id === activeId);
  const activeMode = activeConversation?.mode ?? mode;
  const modeConversations = useMemo(() => snapshot.conversations.filter((item) => item.mode === activeMode), [snapshot.conversations, activeMode]);
  const activeStatus = activeMode === "chat" ? copilotStatus : status;
  const effortKey = activeMode === "chat" ? "aiCopilotReasoningEffort" : "aiReasoningEffort";
  const selectedModelId = preferences.global(activeMode === "chat" ? "aiCopilotModel" : "aiModel");
  const selectedModel = selectedModelId ? models.find((model) => model.id === selectedModelId) : models.find((model) => model.isDefault);
  const efforts = selectedModel?.supportedReasoningEfforts ?? [];
  const preferredEffort = preferences.global(effortKey);
  const selectedEffort = efforts.some((option) => option.effort === preferredEffort) ? preferredEffort : "";
  const activeChanges = useMemo(() => snapshot.changeSets.filter(item => item.conversationId === activeId && item.files.some(file => file.hunks.some(hunk => hunk.decision === "pending"))), [snapshot.changeSets, activeId]);
  const latestMessageContent = activeConversation?.messages[activeConversation.messages.length - 1]?.content;
  const latestReasoning = activeConversation?.messages.at(-1)?.reasoning?.map((part) => part.text).join("\n");
  const lastUserMessageId = [...(activeConversation?.messages ?? [])].reverse().find(message => message.role === "user")?.id;
  const responseRunning = Boolean(taskId) || Boolean(activeConversation?.messages.some((message) => message.status === "streaming"));

  useEffect(() => {
    if (!api) return;
    let active = true;
    const unsubscribeStatus = api.onStatus((next) => { if (active) setStatus(next); });
    const unsubscribeUpdate = api.onUpdate((update) => {
      if (!active) return;
      if (update.kind === "conversation") {
        const incoming = update.payload as AIConversation;
        if (incoming.projectId !== props.projectId) return;
        const conversation = newestConversation(snapshotRef.current.conversations.find(item => item.id === incoming.id), incoming);
        snapshotRef.current = { ...snapshotRef.current, conversations: [conversation, ...snapshotRef.current.conversations.filter(item => item.id !== conversation.id)].sort((a, b) => b.updatedAt - a.updatedAt) };
        setSnapshot(current => ({ ...current, conversations: [newestConversation(current.conversations.find(item => item.id === conversation.id), conversation), ...current.conversations.filter(item => item.id !== conversation.id)] }));
        if (conversation.id === activeIdRef.current && !conversation.messages.some((message) => message.status === "streaming")) { activeTaskIdRef.current = undefined; setTaskId(undefined); setCanceling(false); }
        else if (conversation.id === activeIdRef.current && conversation.activeTaskId) { activeTaskIdRef.current = conversation.activeTaskId; setTaskId(conversation.activeTaskId); }
      } else if (update.kind === "changes") {
        const changeSet = update.payload as AIChangeSet;
        setSnapshot((current) => ({ ...current, changeSets: [changeSet, ...current.changeSets.filter((item) => item.id !== changeSet.id)] }));
      } else {
        const approval = update.payload as AIApprovalRequest;
        setApprovals(current => [...current.filter(item => item.id !== approval.id), ...(approval.status === "pending" ? [approval] : [])]);
      }
    });
    void api.detect().then(async (detected) => {
      if (!active || !detected) return;
      setStatus(detected); setExecutable(detected.executablePath ?? "");
      if (detected.executablePath) void api.status().then((connected) => { if (active && connected) setStatus(connected); }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    void api.copilotStatus().then((detected) => { if (active && detected) setCopilotStatus(detected); }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; unsubscribeStatus(); unsubscribeUpdate(); };
  }, [api, props.projectId]);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void api.approvals(props.projectId).then(value => { if (active) setApprovals(value); }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    void api.conversations(props.projectId).then((value) => {
      if (!active || !value) return;
      const current = snapshotRef.current;
      const conversations = [...value.conversations.map(incoming => newestConversation(current.conversations.find(item => item.id === incoming.id), incoming)), ...current.conversations.filter(item => item.projectId === props.projectId && !value.conversations.some(incoming => incoming.id === item.id))].sort((a, b) => b.updatedAt - a.updatedAt);
      snapshotRef.current = { ...value, conversations };
      setSnapshot(snapshotRef.current);
      const first = conversations.find(item => item.id === activeIdRef.current) ?? conversations[0];
      setActiveId(first?.id);
      activeIdRef.current = first?.id;
      const runningTask = first?.messages.some(message => message.status === "streaming") ? first.activeTaskId : undefined;
      activeTaskIdRef.current = runningTask; setTaskId(runningTask);
      if (first) setMode(first.mode);
      else setMode(preferences.global("aiDefaultMode"));
    }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; };
  }, [api, props.projectId]);

  useEffect(() => {
    if (!api || activeStatus?.auth !== "signed_in") return;
    let active = true;
    setModelsLoading(true);
    setModels([]);
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
  useEffect(() => { setEditingMessageId(undefined); setEditedContent(""); }, [activeId, props.projectId]);
  const composerResizeFrame = useRef<number | undefined>(undefined);
  const resizeComposer = useCallback(() => {
    if (composerResizeFrame.current !== undefined) return;
    composerResizeFrame.current = window.requestAnimationFrame(() => {
      composerResizeFrame.current = undefined;
      const textarea = composerRef.current;
      if (!textarea) return;
      const minHeight = parseFloat(getComputedStyle(textarea).minHeight) || 44;
      const maxHeight = composerExpandedRef.current ? Math.max(minHeight, Math.min(560, window.innerHeight * 0.56)) : minHeight * AI_COMPOSER_HEIGHT_RATIO;
      textarea.style.height = "auto";
      const contentHeight = textarea.scrollHeight;
      textarea.style.height = `${composerExpandedRef.current ? maxHeight : Math.min(contentHeight, maxHeight)}px`;
      textarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
    });
  }, []);
  const setDraft = useCallback((value: string) => {
    draftRef.current = value;
    if (composerRef.current && composerRef.current.value !== value) composerRef.current.value = value;
    const trimmed = value.trim();
    const hasText = Boolean(trimmed), long = trimmed.length > AI_LONG_INPUT_THRESHOLD;
    setDraftSummary(previous => previous.hasText === hasText && previous.long === long ? previous : { hasText, long });
    if (longDraftFileRef.current && longDraftFileRef.current.content !== trimmed) longDraftFileRef.current = undefined;
    resizeComposer();
  }, [resizeComposer]);
  useEffect(() => {
    resizeComposer();
    window.addEventListener("resize", resizeComposer);
    return () => {
      window.removeEventListener("resize", resizeComposer);
      if (composerResizeFrame.current !== undefined) window.cancelAnimationFrame(composerResizeFrame.current);
      composerResizeFrame.current = undefined;
    };
  }, [resizeComposer, activeStatus?.auth, activeId]);
  const toggleComposer = (expanded: boolean) => {
    const input = composerRef.current;
    if (input) composerCaret.current = { start: input.selectionStart, end: input.selectionEnd, scrollTop: input.scrollTop };
    setComposerExpanded(expanded);
  };
  useLayoutEffect(() => {
    resizeComposer();
    const input = composerRef.current;
    if (input && composerCaret.current) {
      input.focus({ preventScroll: true });
      input.setSelectionRange(composerCaret.current.start, composerCaret.current.end);
      input.scrollTop = composerCaret.current.scrollTop;
    }
  }, [composerExpanded, resizeComposer]);
  useEffect(() => {
    if (!composerExpanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); toggleComposer(false); }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [composerExpanded]);
  useEffect(() => { setComposerExpanded(false); }, [activeId, props.projectId]);
  useLayoutEffect(() => {
    followTranscriptRef.current = true;
    setTranscriptAtBottom(true);
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      const transcript = transcriptRef.current;
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
      secondFrame = window.requestAnimationFrame(() => {
        const current = transcriptRef.current;
        if (current) current.scrollTop = current.scrollHeight;
      });
    });
    return () => { window.cancelAnimationFrame(firstFrame); window.cancelAnimationFrame(secondFrame); };
  }, [activeId, props.projectId]);
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    if (followTranscriptRef.current) transcript.scrollTop = transcript.scrollHeight;
    const frame = window.requestAnimationFrame(() => {
      const atBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
      if (followTranscriptRef.current && atBottom) setTranscriptAtBottom(true);
      else setTranscriptAtBottom(atBottom);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeId, activeConversation?.messages.length, latestMessageContent, latestReasoning, activeChanges.length, sending]);
  useEffect(() => {
    const transcript = transcriptRef.current;
    const content = transcript?.firstElementChild;
    if (!transcript || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (followTranscriptRef.current) transcript.scrollTop = transcript.scrollHeight;
      const atBottom = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
      setTranscriptAtBottom(atBottom);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [activeId]);
  useEffect(() => { props.onReviewChanges?.(snapshot.changeSets.filter((item) => item.status === "pending" || item.status === "partially_accepted")); }, [snapshot.changeSets, props.onReviewChanges]);

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

  const addAttachments = async () => {
    if (!api || attachmentsLoading || busy || responseRunning) return;
    setError(""); await attachmentDraft?.pick();
  };
  const addPastedAttachments = async (files: File[]) => {
    if (!api || attachmentsLoading || busy || responseRunning) return;
    setError(""); await attachmentDraft?.paste(files);
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (!files.length) files.push(...Array.from(event.clipboardData.files));
    if (!files.length) return;
    event.preventDefault();
    void addPastedAttachments(files);
  };

  const send = async () => {
    const draft = draftRef.current;
    if (!api || (!draft.trim() && !attachments.length) || responseRunning || busy || attachmentsLoading) return;
    const requestedTaskId = crypto.randomUUID();
    activeTaskIdRef.current = requestedTaskId;
    setTaskId(requestedTaskId);
    setCanceling(false);
    setBusy(true); setSending(true); setError("");
    try {
      const draftContent = draft.trim() || t("ai.attachmentPrompt");
      const attachmentPayload = await attachmentDraft?.payload();
      let messageContent = draftContent;
      if (draftContent.length > AI_LONG_INPUT_THRESHOLD) {
        const bridge = window.latexEditor;
        if (!bridge) throw new Error(t("ui.AIView.the_project_file_service_is_unavailable"));
        const relativePath = longDraftFileRef.current?.content === draftContent
          ? longDraftFileRef.current.path
          : `.texweave/ai-inputs/chat-input-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.txt`;
        if (!longDraftFileRef.current || longDraftFileRef.current.content !== draftContent) {
          await bridge.files.createFile(props.projectId, relativePath);
          longDraftFileRef.current = { content: draftContent, path: relativePath };
        }
        await bridge.files.write(props.projectId, relativePath, draftContent);
        messageContent = t("ai.longMessagePrompt", { path: relativePath });
      }
      let conversation = activeConversation;
      if (!conversation) {
        conversation = await api.createConversation(activeMode, props.projectId);
        if (!conversation) throw new Error(t("ui.AIView.could_not_create_an_ai_conversation"));
        setSnapshot((current) => ({ ...current, conversations: [conversation!, ...current.conversations] }));
        attachmentDraft?.adoptConversation(conversation.id);
        setActiveId(conversation.id);
        activeIdRef.current = conversation.id;
      }
      const contextText = includeSelection && props.selectedText ? `Current selection in ${props.currentFile ?? "the editor"}:\n${props.selectedText}` : undefined;
      const started = await api.send({ conversationId: conversation.id, taskId: requestedTaskId, projectId: props.projectId, content: messageContent, ...attachmentPayload, ...(contextText ? { contextText } : {}), overrides: props.overrides });
      if (started) {
        const latest = snapshotRef.current.conversations.find((item) => item.id === started.conversation.id);
        const newest = newestConversation(latest, started.conversation);
        const stillRunning = newest.messages.some((message) => message.status === "streaming");
        const currentTaskId = stillRunning ? started.taskId || requestedTaskId : undefined;
        activeTaskIdRef.current = currentTaskId;
        setTaskId(currentTaskId);
        if (!stillRunning) setCanceling(false);
        setSnapshot((current) => {
          const existing = current.conversations.find((item) => item.id === started.conversation.id);
          const newest = newestConversation(existing, started.conversation);
          return { ...current, conversations: [newest, ...current.conversations.filter((item) => item.id !== started.conversation.id)] };
        });
      } else { activeTaskIdRef.current = undefined; setTaskId(undefined); setCanceling(false); }
      setDraft("");
      if (attachmentPayload) attachmentDraft?.sent(attachmentPayload);
      longDraftFileRef.current = undefined;
    } catch (reason) { activeTaskIdRef.current = undefined; setTaskId(undefined); setCanceling(false); setError(messageOf(reason)); }
    finally { setBusy(false); setSending(false); }
  };

  const editAndResend = async (messageId: string) => {
    if (!api || !activeConversation || !editedContent.trim() || responseRunning || busy) return;
    const requestedTaskId = crypto.randomUUID();
    activeTaskIdRef.current = requestedTaskId;
    setTaskId(requestedTaskId); setCanceling(false); setBusy(true); setSending(true); setError("");
    try {
      const started = await api.send({ conversationId: activeConversation.id, taskId: requestedTaskId, projectId: props.projectId, content: editedContent, overrides: props.overrides, editMessageId: messageId });
      if (!started) throw new Error(t("ai.editUnavailable"));
      const newest = newestConversation(snapshotRef.current.conversations.find(item => item.id === started.conversation.id), started.conversation);
      const stillRunning = newest.messages.some(message => message.status === "streaming");
      const currentTaskId = stillRunning ? started.taskId || requestedTaskId : undefined;
      activeTaskIdRef.current = currentTaskId; setTaskId(currentTaskId); setCanceling(false);
      const cutoff = activeConversation.messages.find(message => message.id === messageId)?.createdAt ?? 0;
      const nextSnapshot = { ...snapshotRef.current, conversations: [newest, ...snapshotRef.current.conversations.filter(item => item.id !== newest.id)], changeSets: snapshotRef.current.changeSets.filter(item => item.conversationId !== newest.id || item.createdAt < cutoff) };
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setEditingMessageId(undefined); setEditedContent("");
    } catch (reason) { activeTaskIdRef.current = undefined; setTaskId(undefined); setCanceling(false); setError(messageOf(reason)); }
    finally { setBusy(false); setSending(false); }
  };

  const cancel = async () => {
    const currentTaskId = activeTaskIdRef.current ?? taskId;
    if (!api || !currentTaskId || canceling) return;
    setCanceling(true);
    try { await api.cancel(currentTaskId); } catch (reason) { setError(messageOf(reason)); }
    finally { setCanceling(false); }
  };

  const scrollTranscriptToBottom = () => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    followTranscriptRef.current = true;
    setTranscriptAtBottom(true);
    transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
  };

  const reviewChanges = async (changeSet: AIChangeSet, ids: string[], keep: boolean) => {
    if (!api || changesBusy) return;
    setChangesBusy(true); setError(""); setNotice("");
    try {
      if (keep) {
        const selected = new Set(ids);
        const appliedIds: string[] = [];
        const unapplied = changeSet.files.flatMap(file => file.hunks.filter(hunk => selected.has(hunk.id) && hunk.decision === "pending").map(hunk => hunk.id));
        let staleStructureIds: string[] = [];
        if (unapplied.length) {
          const result = await props.onApplyChanges(changeSet, unapplied);
          appliedIds.push(...result.appliedIds);
          staleStructureIds = result.staleStructureIds;
        }
        const accepted = new Set(appliedIds);
        const stale = new Set(staleStructureIds);
        const decisions: Record<string, "accepted" | "rejected"> = {};
        for (const id of ids) {
          if (accepted.has(id)) decisions[id] = "accepted";
          else if (stale.has(id)) decisions[id] = "rejected";
        }
        const resolved = await api.resolveChangeSet(changeSet.id, decisions, true);
        if (!resolved) throw new Error(t("ai.changeUnavailable"));
        if (resolved) setSnapshot(current => ({ ...current, changeSets: current.changeSets.map(item => item.id === resolved.id ? resolved : item) }));
        if (staleStructureIds.length) setNotice(t("ai.staleStructureDiscarded", { count: staleStructureIds.length }));
      } else await props.onUndoChanges(changeSet, ids);
      if (!keep) {
        const decisions = Object.fromEntries(ids.map(id => [id, "rejected" as const]));
        const resolved = await api.resolveChangeSet(changeSet.id, decisions, false);
        if (!resolved) throw new Error(t("ai.changeUnavailable"));
        if (resolved) setSnapshot(current => ({ ...current, changeSets: current.changeSets.map(item => item.id === resolved.id ? resolved : item) }));
      }
    } catch (reason) {
      const message = messageOf(reason);
      setError(message);
      try {
        const failed = await api.markChangeSetApplied(changeSet.id, [], message);
        if (failed) setSnapshot(current => ({ ...current, changeSets: current.changeSets.map(item => item.id === failed.id ? failed : item) }));
      } catch { /* Keep the local error visible if the history service is unavailable. */ }
    }
    finally { setChangesBusy(false); }
  };
  const renameConversation = async (id: string, title: string) => {
    const renamed = await api?.renameConversation(id, title);
    if (renamed) setSnapshot(current => ({ ...current, conversations: current.conversations.map(item => item.id === id ? renamed : item) }));
  };
  const resolveApproval = async (id: string, allow: boolean) => {
    try { await api?.resolveApproval(id, allow); }
    catch (reason) { setError(messageOf(reason)); }
  };
  const removeConversations = async (ids: string[]) => {
    if (!api || historyDeleting) return;
    const removed = new Set<string>();
    setHistoryDeleting(true);
    try {
      for (const id of ids) { await api.removeConversation(id); removed.add(id); }
    } finally {
      // Prune only confirmed deletions from the latest state, including when a
      // later deletion fails or a streaming update arrives during this batch.
      setSnapshot((current) => ({ conversations: current.conversations.filter((item) => !removed.has(item.id)), changeSets: current.changeSets.filter((item) => !removed.has(item.conversationId)) }));
      if (activeIdRef.current && removed.has(activeIdRef.current)) {
        setActiveId(snapshotRef.current.conversations.find((item) => !removed.has(item.id) && item.mode === activeMode)?.id);
        setMode(activeMode); setDraft("");
      }
      setHistoryDeleting(false);
    }
  };

  if (!api) return null;

  const composer = <div className={`ai-composer${composerExpanded ? " expanded" : ""}`}>
          <button type="button" className="ai-composer-expand" aria-expanded={composerExpanded} title={t(composerExpanded ? "ai.composerCollapse" : "ai.composerExpand")} aria-label={t(composerExpanded ? "ai.composerCollapse" : "ai.composerExpand")} onMouseDown={event => event.preventDefault()} onClick={() => toggleComposer(!composerExpanded)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={composerExpanded ? "M9 3v6H3m18 6h-6v6M3 9l6-6m6 18 6-6" : "M15 3h6v6M3 15v6h6M21 3l-7 7M3 21l7-7"}/></svg></button>
          <textarea ref={composerRef} rows={1} defaultValue={draftRef.current} onChange={(event) => setDraft(event.target.value)} onPaste={handleComposerPaste} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={t("ai.messagePlaceholder")} aria-label={t("ai.messagePlaceholder")}/>
          {attachments.length > 0 && <div className="ai-draft-attachments">{attachments.map((attachment) => <span className="ai-attachment-chip" key={attachment.id} title={`${attachment.name} · ${(attachment.size / 1024).toFixed(1)} KB`}><span>▧ {attachment.name}</span><button aria-label={t("ai.removeAttachment", { name: attachment.name })} disabled={sending} onClick={() => void attachmentDraft?.remove(attachment.id)}>×</button></span>)}</div>}
          <div className="ai-composer-actions">
            <button className="ai-add-attachment" title={t("ai.addAttachment")} aria-label={t("ai.addAttachment")} disabled={busy || attachmentsLoading || responseRunning} onClick={() => void addAttachments()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
            <PermissionPicker value={preferences.global("aiPermissionMode")} disabled={busy || responseRunning} onChange={mode => void preferences.set("aiPermissionMode", mode)}/>
            <select className="ai-composer-model" aria-label={t("ai.model")} title={t("ai.model")} value={selectedModelId} disabled={modelsLoading || busy || responseRunning} onChange={(event) => void preferences.set(activeMode === "chat" ? "aiCopilotModel" : "aiModel", event.target.value)}><option value="">{t(modelsLoading ? "ai.loadingModels" : "ai.defaultModel")}</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name}{model.isDefault ? ` (${t("ai.recommended")})` : ""}</option>)}</select>
            <ReasoningEffortPicker value={selectedEffort} defaultEffort={selectedModel?.defaultReasoningEffort} efforts={efforts} modelName={selectedModel?.name ?? t("ai.defaultModel")} disabled={modelsLoading || busy || responseRunning} onChange={effort => void preferences.set(effortKey, effort)}/>
            {responseRunning ? <button className="ai-send-button stopping" title={t(canceling ? "ai.stopping" : "ai.stop")} aria-label={t(canceling ? "ai.stopping" : "ai.stop")} disabled={!taskId || canceling} onClick={() => void cancel()}><svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="12" height="12" rx="2"/></svg></button> : <button className="ai-send-button" title={t("ai.send")} aria-label={t("ai.send")} disabled={busy || attachmentsLoading || (!draftSummary.hasText && !attachments.length)} onClick={() => void send()}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button>}
          </div>
        </div>;

  return <section className="ai-sidebar" aria-label={t("ai.title")}>
    <div className="ai-workspace-controls ai-conversation-heading">
      <ConversationPicker key={`${props.projectId}:${activeMode}`} conversations={modeConversations} activeId={activeId} disabled={busy || historyDeleting || Boolean(taskId)} protectedId={busy || taskId ? activeId : undefined} onSelect={(id) => { setActiveId(id); setMode(activeMode); }} onNew={() => void newConversation(activeMode)} onRename={renameConversation} onDelete={removeConversations}/>
      <div className="ai-provider-account-row"><div className="ai-mode-switch" role="tablist"><button role="tab" aria-selected={activeMode === "chat"} className={activeMode === "chat" ? "active" : ""} disabled={busy || historyDeleting || Boolean(taskId)} onClick={() => void switchMode("chat")}>{t("ai.copilot")}</button><button role="tab" aria-selected={activeMode === "codex"} className={activeMode === "codex" ? "active" : ""} disabled={busy || historyDeleting || Boolean(taskId)} onClick={() => void switchMode("codex")}>{t("ai.codex")}</button></div>{activeStatus?.auth === "signed_in" && <div className="ai-account-line"><span className="ai-status-dot ready" title={t("ai.signedIn")}/><span className="ai-account-name" title={activeStatus.accountLabel ?? t("ai.signedIn")}>{activeStatus.accountLabel ?? t(activeMode === "chat" ? "ai.copilotAccount" : "ai.chatgptAccount")}</span><button className="ai-quiet-action ai-settings-icon" title={t("ai.settings")} aria-label={t("ai.settings")} onClick={props.onOpenSettings}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 2 3-1 1-3 3-1 1-3-2-2 1-3-3-2-3 1Z"/></svg></button><button className="ai-quiet-action ai-sign-out" title={t("ai.signOut")} aria-label={t("ai.signOut")} disabled={busy || responseRunning} onClick={() => void runStatus(() => activeMode === "chat" ? api.logoutCopilot() : api.logout(), false, activeMode)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4H4v16h5m5-13 5 5-5 5m-5-5h10"/></svg></button></div>}</div>
    </div>

    {!activeStatus && <div className="ai-connect-scroll"><p>{t("ai.checking")}</p></div>}
    {activeStatus && activeStatus.auth !== "signed_in" && <div className="ai-connect-scroll"><div className="ai-connect-card">
      <strong>{activeMode === "chat" ? t(activeStatus.process === "not_detected" ? "ai.copilotRequired" : "ai.copilotConnectTitle") : t(activeStatus.process === "not_detected" ? "ai.codexRequired" : activeStatus.process === "crashed" ? "ai.connectionFailed" : "ai.connectTitle")}</strong>
      <p>{activeMode === "chat" ? t(activeStatus.process === "not_detected" ? "ai.copilotRequiredHint" : "ai.copilotConnectHint") : t(activeStatus.process === "not_detected" ? "ai.codexRequiredHint" : activeStatus.process === "crashed" ? "ai.connectionFailedHint" : "ai.connectHint")}</p>
      {activeMode === "codex" && activeStatus.executablePath && <small className="ai-cli-path" title={activeStatus.executablePath}>{t("ai.cliDetected")}<br/>{activeStatus.executablePath}</small>}
      {activeMode === "codex" && (activeStatus.process === "not_detected" || activeStatus.process === "crashed") && <label className="ai-executable-field">{t("ai.executablePath")}<input value={executable} onChange={(event) => setExecutable(event.target.value)} placeholder="codex.exe" spellCheck={false}/><button disabled={busy || !executable.trim()} onClick={() => void runStatus(() => api.setExecutable(executable.trim()), true, "codex")}>{t("ai.savePath")}</button></label>}
      {activeMode === "chat" && activeStatus.process === "not_detected" && <button className="primary-button" disabled={busy} onClick={() => void runStatus(() => api.installCopilot(), false, "chat")}>{t(busy ? "ai.installingCopilot" : "ai.installCopilot")}</button>}
      {activeMode === "chat" && activeStatus.executablePath && <button className="primary-button" disabled={busy || activeStatus.auth === "authenticating"} onClick={() => void runStatus(() => api.loginCopilot(), false, "chat")}>{t(activeStatus.auth === "authenticating" ? "ai.signingIn" : "ai.signInGitHub")}</button>}
      {activeMode === "codex" && activeStatus.process === "not_detected" && <button className="primary-button" disabled={busy} onClick={() => void runStatus(() => api.install(), true, "codex")}>{t(busy ? "ai.installing" : "ai.installCodex")}</button>}
      {activeMode === "codex" && activeStatus.process !== "not_detected" && <button className="primary-button" disabled={busy || activeStatus.process === "starting" || activeStatus.auth === "authenticating"} onClick={() => void runStatus(() => api.login(), false, "codex")}>{t(activeStatus.auth === "authenticating" ? "ai.signingIn" : "ai.signIn")}</button>}
      <button className="secondary-button ai-recheck" disabled={busy || (activeMode === "codex" && activeStatus.auth === "authenticating")} onClick={() => void runStatus(() => activeMode === "chat" ? api.copilotStatus() : api.detect(), false, activeMode)}>{t("ai.detectAgain")}</button>
    </div>{(error || activeStatus.error) && <div className="inline-error ai-error" role="alert">{error || activeStatus.error}</div>}</div>}
    {activeStatus?.auth === "signed_in" && <>
      <div className="ai-transcript-shell">
      <div ref={transcriptRef} className="ai-conversation-body" aria-live="polite" onScroll={(event) => { const element = event.currentTarget; const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80; followTranscriptRef.current = atBottom; setTranscriptAtBottom(atBottom); }}>
        <div className="ai-message-list">{activeConversation?.messages.map((message) => <article key={message.id} className={`ai-message ${message.role} ${message.status ?? ""}`}>
          <div className="ai-message-heading"><small>{message.role === "user" ? t("ai.you") : message.role === "assistant" ? t("ai.assistant") : message.role}</small></div>
          {message.role === "assistant" && <AIResponse message={message} projectRoot={props.projectRoot} {...(props.mathContext ? { mathContext: props.mathContext } : {})} onOpenFile={props.onOpenFile}/>}
          {editingMessageId === message.id ? <div className="ai-message-edit"><textarea value={editedContent} onChange={event => setEditedContent(event.target.value)} aria-label={t("ai.editMessage")} autoFocus/><div><button type="button" disabled={busy || !editedContent.trim()} onClick={() => void editAndResend(message.id)}>{t("ai.editResend")}</button><button type="button" disabled={busy} onClick={() => { setEditingMessageId(undefined); setEditedContent(""); }}>{t("ai.cancelEdit")}</button></div></div> : message.role !== "assistant" && message.content && <div className="ai-message-content"><AIMessageContent content={message.content} projectRoot={props.projectRoot} {...(props.mathContext ? { mathContext: props.mathContext } : {})} {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}/></div>}
          {!!message.attachments?.length && <div className="ai-message-attachments">{message.attachments.map((attachment) => <span key={attachment.id} title={attachment.name}>▧ {attachment.name}</span>)}</div>}
          <div className="ai-message-actions"><button type="button" className="ai-edit-message" disabled={!message.content} title={t("editor.context.copy")} aria-label={t("editor.context.copy")} onClick={() => { void navigator.clipboard.writeText(message.content).catch(reason => setError(messageOf(reason))); }}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/></svg></button>{message.role === "user" && message.id === lastUserMessageId && !responseRunning && !sending && editingMessageId !== message.id && <button type="button" className="ai-edit-message" disabled={busy} title={t("ai.editMessage")} aria-label={t("ai.editMessage")} onClick={() => { setEditingMessageId(message.id); setEditedContent(message.content); setError(""); }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z"/></svg></button>}</div>
        </article>)}{!activeConversation?.messages.length && !sending && <p className="ai-empty-chat">{t(activeMode === "chat" ? "ai.chatReady" : "ai.codexReady")}</p>}
        {sending && responseRunning && !activeConversation?.messages.some((message) => message.status === "streaming") && <div className="ai-task-status" role="status"><span className="ai-thinking-spinner" aria-hidden="true"/>{t("ai.thinking")}</div>}</div>
        {activeChanges.map(changeSet => <ChangesCard key={changeSet.id} changes={changeSet} busy={changesBusy || responseRunning} onKeep={ids => void reviewChanges(changeSet, ids, true)} onDiscard={ids => void reviewChanges(changeSet, ids, false)} onView={path => props.onViewChanges(changeSet, path)}/>)}
      </div>
      {!transcriptAtBottom && <button type="button" className="ai-scroll-bottom" title={t("ai.scrollToLatest")} aria-label={t("ai.scrollToLatest")} onClick={scrollTranscriptToBottom}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v15m-6-6 6 6 6-6"/></svg></button>}
      </div>
      <footer className="ai-composer-dock">
        {approvals.filter(request => request.conversationId === activeId).map(request => <section className="ai-approval-card" key={request.id} role="alert"><strong>{t("ai.approvalRequired")}</strong><p>{request.description}</p>{request.command && <pre>{request.command}</pre>}{request.paths.length > 0 && <small>{request.paths.join("\n")}</small>}<div><button onClick={() => void resolveApproval(request.id, false)}>{t("ai.denyAction")}</button><button onClick={() => void resolveApproval(request.id, true)}>{t("ai.allowAction")}</button></div></section>)}
        {props.selectedText && <div className="ai-context-options"><label><input type="checkbox" checked={includeSelection} onChange={(event) => setIncludeSelection(event.target.checked)}/>{t("ai.includeSelection")}</label></div>}
          {(error || activeStatus.error) && <div className="inline-error ai-error" role="alert">{error || activeStatus.error}</div>}
          {notice && <div className="ai-resolution-notice" role="status">{notice}</div>}
        {draftSummary.long && <div className="ai-long-input-note">{t("ai.longMessageHint")}</div>}
        {composerExpanded ? createPortal(<div className="ai-composer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) toggleComposer(false); }}><section className="ai-composer-expanded-panel" role="dialog" aria-modal="true" aria-label={t("ai.composerExpand")}>{composer}</section></div>, document.body) : composer}
      </footer>
    </>}
  </section>;
}

function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
