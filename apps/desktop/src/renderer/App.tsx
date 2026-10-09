import { styleResourceName, styleResourceDescription } from "./i18n/displayNames.js";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { Project, StyleResource } from "@latex-editor/contracts";
import { t } from "./i18n/index.js";
import { Workbench } from "./workbench/Workbench.js";
import { useSettings, settings } from "./settings/service.js";
import { SettingsDialog } from "./settings/SettingsDialog.js";
import { commands, installShortcuts } from "./settings/commands.js";
import { DEFAULT_ENVIRONMENTS, includeNewBuiltInEnvironments } from "./preview/environments.js";
import type { EnvironmentDefinition } from "./preview/types.js";
import { ThemeRuntime } from "./themes/runtime.js";
import { ReferenceLibraryPage } from "./references/ReferenceLibraryPage.js";
import { flushSync } from "react-dom";
import { resolveExit, unsavedChanges } from "./lifecycle/unsavedChanges.js";
import { chooseProjectAvatarColor, isProjectAvatarColor, projectAvatarLetter, projectAvatarPalette, type ProjectAvatarColor } from "./projectAvatar.js";
import { installWheelAcceleration } from "./wheelAcceleration.js";

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}

function WeaveLogo({ size = 34 }: { size?: number }) {
  return <svg aria-hidden="true" className="weave-logo" width={size} height={size} viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="41" stroke="currentColor" strokeWidth="2" opacity=".38"/><path d="M50 9C67 25 67 75 50 91C33 75 33 25 50 9ZM9 50C25 33 75 33 91 50C75 67 25 67 9 50Z" stroke="currentColor" strokeWidth="2.4" opacity=".88"/><path d="M20 21C47 28 72 53 79 80M80 20C53 28 28 53 21 80" stroke="currentColor" strokeWidth="1.5" opacity=".58"/><circle cx="50" cy="50" r="8.5" fill="currentColor"/><circle cx="50" cy="9" r="3" fill="currentColor"/><circle cx="91" cy="50" r="3" fill="currentColor"/><circle cx="50" cy="91" r="3" fill="currentColor"/><circle cx="9" cy="50" r="3" fill="currentColor"/></svg>;
}

function GearIcon() { return <Icon><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.5 1A8 8 0 0 0 14.7 6L14.4 3h-4.8L9.3 6a8 8 0 0 0-1.7 1.1l-2.5-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .3 0 .7.1 1l-2 1.5 2 3.4 2.5-1A8 8 0 0 0 9.3 18l.3 3h4.8l.3-3a8 8 0 0 0 1.7-1.1l2.5 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z"/></Icon>; }
function PlusIcon() { return <Icon size={18}><path d="M12 5v14M5 12h14"/></Icon>; }
function FolderIcon() { return <Icon size={18}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2H18.5A2.5 2.5 0 0 1 21 9.5v6A2.5 2.5 0 0 1 18.5 18h-13A2.5 2.5 0 0 1 3 15.5v-8Z"/></Icon>; }
function SearchIcon() { return <Icon size={18}><circle cx="10.8" cy="10.8" r="6.3"/><path d="m16 16 4.2 4.2"/></Icon>; }
function ChevronIcon() { return <Icon size={16}><path d="m6 9 6 6 6-6"/></Icon>; }

type DirectoryTab = "all" | "pinned" | "favorites" | "recent";
type DirectorySort = "lastOpened" | "name" | "dateAdded";
type DirectoryPreferences = { tab: DirectoryTab; sort: DirectorySort; direction: "asc" | "desc"; density: "compact" | "comfortable" };
const defaultDirectoryPreferences: DirectoryPreferences = { tab: "all", sort: "lastOpened", direction: "desc", density: "compact" };
function directoryMetadata(project: Project): { displayName: string; isFavorite: boolean; isPinned: boolean; avatarLetter: string; avatarColor: ProjectAvatarColor } {
  const saved = project.settings.projectDirectory;
  const meta = saved && typeof saved === "object" ? saved as Record<string, unknown> : {};
  const displayName = typeof meta.displayName === "string" ? meta.displayName : project.name;
  const savedLetter = typeof meta.avatarLetter === "string" ? Array.from(meta.avatarLetter.trim()) : [];
  return {
    displayName,
    isFavorite: meta.isFavorite === true,
    isPinned: meta.isPinned === true,
    avatarLetter: savedLetter.length === 1 ? projectAvatarLetter(savedLetter[0]!) : projectAvatarLetter(displayName),
    avatarColor: isProjectAvatarColor(meta.avatarColor) ? meta.avatarColor.toLocaleLowerCase("en-US") as ProjectAvatarColor : projectAvatarPalette[0].foreground
  };
}
function hasSavedAvatarIdentity(project: Project): boolean {
  const saved = project.settings.projectDirectory;
  const meta = saved && typeof saved === "object" ? saved as Record<string, unknown> : {};
  return typeof meta.avatarLetter === "string" && Array.from(meta.avatarLetter.trim()).length === 1 && isProjectAvatarColor(meta.avatarColor);
}
function comparablePath(path: string): string { return path.replace(/[\\/]+$/, "").toLocaleLowerCase(); }
function formatLastOpened(project: Project): string {
  if (!project.lastOpenedAt) return t("directory.never");
  const date = new Date(project.lastOpenedAt);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return new Date().toDateString() === date.toDateString() ? `${t("project.today")}, ${time}` : date.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

function ProjectStyleResourcePicker({ styleResources, baseResource, setBaseResource, extraResources, setExtraResources }: {
  styleResources: StyleResource[];
  baseResource: string;
  setBaseResource(value: string): void;
  extraResources: string[];
  setExtraResources: Dispatch<SetStateAction<string[]>>;
}) {
  const [resourceToAdd, setResourceToAdd] = useState("");
  const presets = styleResources.filter((resource) => resource.source === "built-in");
  const customResources = styleResources.filter((resource) => resource.source === "user");
  const selectedPreset = presets.find((resource) => resource.id === baseResource);
  const selectedResources = customResources.filter((resource) => extraResources.includes(resource.id));

  const addSelectedResource = () => {
    if (!resourceToAdd || extraResources.includes(resourceToAdd)) return;
    setExtraResources((current) => [...current, resourceToAdd]);
    setResourceToAdd("");
  };

  return <fieldset className="resource-picker">
    <legend>{t("resource.choose")}</legend>
    <p>{t("resource.chooseHint")}</p>
    <div className="resource-picker-fields">
      <label className="resource-picker-control"><span>{t("resource.builtIn")}</span>
        <select value={baseResource} onChange={(event) => setBaseResource(event.target.value)}>
          {presets.map((resource) => <option key={resource.id} value={resource.id}>{styleResourceName(resource)}</option>)}
        </select>
        {selectedPreset?.description && <small className="resource-picker-description">{styleResourceDescription(selectedPreset)}</small>}
      </label>
      <div className="resource-picker-control"><label htmlFor="project-extra-style">{t("resource.myResources")}</label>
        <div className="resource-picker-add"><select id="project-extra-style" value={resourceToAdd} onChange={(event) => setResourceToAdd(event.target.value)}>
          <option value="">{t("resource.chooseCustom")}</option>
          {customResources.map((resource) => <option key={resource.id} value={resource.id} disabled={extraResources.includes(resource.id)}>{styleResourceName(resource)}</option>)}
        </select><button type="button" aria-label={t("resource.addToProject")} title={t("resource.addToProject")} disabled={!resourceToAdd} onClick={addSelectedResource}>＋</button></div>
        {customResources.length === 0 && <small className="resource-picker-description">{t("resource.none")}</small>}
      </div>
    </div>
    {selectedResources.length > 0 && <div className="resource-picker-selected" role="group" aria-label={t("resource.myResources")}>
      {selectedResources.map((resource) => <span className="resource-picker-chip" key={resource.id} title={resource.description ?? resource.name}><span>{resource.name}</span><button type="button" aria-label={`${t("resource.removeFromProject")}: ${resource.name}`} onClick={() => setExtraResources((current) => current.filter((id) => id !== resource.id))}>×</button></span>)}
    </div>}
  </fieldset>;
}

function ProjectDirectory({ projects, onProjectsChange, onOpen, onOpenLibrary, styleResources, onRefreshResources }: { projects: Project[]; onProjectsChange: Dispatch<SetStateAction<Project[]>>; onOpen(project: Project): void; onOpenLibrary(): void; styleResources: StyleResource[]; onRefreshResources(): Promise<void> }) {
  useSettings();
  useEffect(() => commands.register("settings.open", { execute: () => setSettingsOpen(true) }), []);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [menuProjectId, setMenuProjectId] = useState<string>();
  const [preferences, setPreferences] = useState<DirectoryPreferences>(() => {
    try { return { ...defaultDirectoryPreferences, ...JSON.parse(localStorage.getItem("texweave.projectDirectory.v1") ?? "{}") as Partial<DirectoryPreferences> }; }
    catch { return defaultDirectoryPreferences; }
  });
  const [name, setName] = useState("");
  const [parentPath, setParentPath] = useState("");
  const [baseResource, setBaseResource] = useState("default");
  const [extraResources, setExtraResources] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const api = window.latexEditor;
  const searchRef = useRef<HTMLInputElement>(null);
  const avatarAssignmentInProgress = useRef(false);
  const failedAvatarAssignments = useRef(new Set<string>());
  const [avatarAssignmentRevision, setAvatarAssignmentRevision] = useState(0);
  useEffect(() => { localStorage.setItem("texweave.projectDirectory.v1", JSON.stringify(preferences)); }, [preferences]);
  useEffect(() => {
    if (!api || avatarAssignmentInProgress.current) return;
    const needsIdentity = projects.filter((project) => !hasSavedAvatarIdentity(project) && !failedAvatarAssignments.current.has(project.id));
    if (!needsIdentity.length) return;

    avatarAssignmentInProgress.current = true;
    const usedColors = projects.flatMap((project) => {
      const saved = project.settings.projectDirectory;
      const meta = saved && typeof saved === "object" ? saved as Record<string, unknown> : {};
      return isProjectAvatarColor(meta.avatarColor) ? [meta.avatarColor.toLocaleLowerCase("en-US")] : [];
    });
    void (async () => {
      for (const project of needsIdentity) {
        const saved = project.settings.projectDirectory;
        const meta = saved && typeof saved === "object" ? saved as Record<string, unknown> : {};
        const letter = typeof meta.avatarLetter === "string" && Array.from(meta.avatarLetter.trim()).length === 1
          ? projectAvatarLetter(meta.avatarLetter.trim())
          : projectAvatarLetter(directoryMetadata(project).displayName);
        const color = isProjectAvatarColor(meta.avatarColor)
          ? meta.avatarColor.toLocaleLowerCase("en-US")
          : chooseProjectAvatarColor(usedColors);
        if (!usedColors.includes(color)) usedColors.push(color);
        try {
          const updated = await api.projects.updateDirectoryEntry(project.id, { avatarLetter: letter, avatarColor: color });
          onProjectsChange((current) => current.map((item) => item.id === updated.id ? { ...item, settings: updated.settings } : item));
        } catch (reason) {
          failedAvatarAssignments.current.add(project.id);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
    })().finally(() => {
      avatarAssignmentInProgress.current = false;
      setAvatarAssignmentRevision((revision) => revision + 1);
    });
  }, [api, avatarAssignmentRevision, onProjectsChange, projects]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); } };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const visible = projects.filter((project) => {
      const meta = directoryMetadata(project);
      if (preferences.tab === "pinned" && !meta.isPinned) return false;
      if (preferences.tab === "favorites" && !meta.isFavorite) return false;
      if (preferences.tab === "recent" && !project.lastOpenedAt) return false;
      return !needle || `${meta.displayName} ${project.mainFile ?? ""} ${project.canonicalPath}`.toLocaleLowerCase().includes(needle);
    });
    const direction = preferences.direction === "asc" ? 1 : -1;
    return visible.sort((a, b) => {
      if (preferences.tab === "all" && directoryMetadata(a).isPinned !== directoryMetadata(b).isPinned) return directoryMetadata(a).isPinned ? -1 : 1;
      let compare = 0;
      if (preferences.sort === "name") compare = directoryMetadata(a).displayName.localeCompare(directoryMetadata(b).displayName, undefined, { sensitivity: "base" });
      else if (preferences.sort === "dateAdded") compare = a.registeredAt.localeCompare(b.registeredAt);
      else {
        if (!a.lastOpenedAt && b.lastOpenedAt) return 1;
        if (a.lastOpenedAt && !b.lastOpenedAt) return -1;
        compare = (a.lastOpenedAt ?? "").localeCompare(b.lastOpenedAt ?? "");
      }
      return compare === 0 ? a.id.localeCompare(b.id) : compare * direction;
    });
  }, [projects, query, preferences]);
  const counts = useMemo(() => ({ all: projects.length, pinned: projects.filter((project) => directoryMetadata(project).isPinned).length, favorites: projects.filter((project) => directoryMetadata(project).isFavorite).length, recent: projects.filter((project) => !!project.lastOpenedAt).length }), [projects]);
  useEffect(() => { setSelectedIds((ids) => ids.filter((id) => filtered.some((project) => project.id === id))); }, [filtered]);
  useEffect(() => {
    if (!menuOpen && !workspaceMenuOpen && !menuProjectId) return;
    const closeWhenOutside = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : undefined;
      if (!target?.closest(".directory-new-control")) setMenuOpen(false);
      if (!target?.closest(".directory-workspace-button, .workspace-popover")) setWorkspaceMenuOpen(false);
      if (!target?.closest(".directory-row-menu")) setMenuProjectId(undefined);
    };
    document.addEventListener("mousedown", closeWhenOutside);
    return () => document.removeEventListener("mousedown", closeWhenOutside);
  }, [menuOpen, workspaceMenuOpen, menuProjectId]);

  const chooseFolder = async () => { const folder = await api?.dialogs.pickFolder(); if (folder) setParentPath(folder); };
  const registerFolder = async () => {
    setMenuOpen(false); const folder = await api?.dialogs.pickFolder(); if (!folder || !api) return; setBusy(true);
    try { const project = await api.projects.register(folder); onProjectsChange((current) => [project, ...current]); setQuery(""); setPreferences((value) => ({ ...value, tab: "all" })); }
    catch (reason) {
      const refreshed = await api.projects.list().catch(() => projects);
      onProjectsChange(refreshed);
      const existing = refreshed.find((item) => comparablePath(item.canonicalPath) === comparablePath(folder));
      if (existing) { if (window.confirm(t("directory.duplicateProject", { name: directoryMetadata(existing).displayName }))) onOpen(existing); }
      else setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  };
  const createProject = async () => { if (!api || !name.trim() || !parentPath.trim()) return; setBusy(true); try { const project = await api.projects.create({ name: name.trim(), parentPath: parentPath.trim(), styleResourceIds: [baseResource, ...extraResources] }); onProjectsChange([project, ...projects]); setCreateOpen(false); setName(""); setQuery(""); setPreferences((value) => ({ ...value, tab: "all" })); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };
  const updateEntry = async (project: Project, patch: { displayName?: string; isFavorite?: boolean; isPinned?: boolean }) => {
    if (!api) return;
    try { const updated = await api.projects.updateDirectoryEntry(project.id, patch); onProjectsChange((current) => current.map((item) => item.id === updated.id ? { ...item, settings: updated.settings } : item)); setError(undefined); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const updateMany = async (patch: { isFavorite?: boolean; isPinned?: boolean }) => {
    for (const id of selectedIds) { const project = projects.find((item) => item.id === id); if (project) await updateEntry(project, patch); }
  };
  const removeFromList = async (project: Project) => {
    if (!api || !window.confirm(t("directory.confirmRemove", { name: directoryMetadata(project).displayName }))) return;
    try { await api.projects.removeFromDirectory(project.id); onProjectsChange(projects.filter((item) => item.id !== project.id)); setSelectedIds((ids) => ids.filter((id) => id !== project.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const deleteFromDisk = async (project: Project) => {
    if (!api || !window.confirm(t("directory.confirmDelete", { name: directoryMetadata(project).displayName, path: project.canonicalPath }))) return;
    try { await api.projects.deleteToRecycleBin(project.id, project.canonicalPath); onProjectsChange(projects.filter((item) => item.id !== project.id)); setSelectedIds((ids) => ids.filter((id) => id !== project.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const locateProject = async (project: Project) => {
    if (!api) return;
    const folder = await api.dialogs.pickFolder();
    if (!folder) return;
    setBusy(true);
    try { const updated = await api.projects.relocateInDirectory(project.id, folder); onProjectsChange((current) => current.map((item) => item.id === project.id ? updated : item)); setError(undefined); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); setMenuProjectId(undefined); }
  };
  const openProjectEntry = (project: Project) => {
    if (project.missing) { setError(t("directory.locationMissingDetail", { path: project.canonicalPath })); return; }
    onOpen(project);
  };
  const openProjectMenu = (project: Project) => setMenuProjectId((current) => current === project.id ? undefined : project.id);
  const performProjectMenuAction = async (action: string, project: Project) => {
    setMenuProjectId(undefined);
    if (action === "open") openProjectEntry(project);
    else if (action === "reveal") { try { await api?.projects.revealInFileManager(project.id); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }
    else if (action === "copy") { try { await api?.projects.copyProjectPath(project.id); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }
    else if (action === "favorite") await updateEntry(project, { isFavorite: !directoryMetadata(project).isFavorite });
    else if (action === "pin") await updateEntry(project, { isPinned: !directoryMetadata(project).isPinned });
    else if (action === "rename") { const next = window.prompt(t("directory.renamePrompt"), directoryMetadata(project).displayName); if (next?.trim()) await updateEntry(project, { displayName: next.trim() }); }
    else if (action === "remove") await removeFromList(project);
    else if (action === "delete") await deleteFromDisk(project);
  };
  const removeSelected = async () => {
    const selected = projects.filter((project) => selectedIds.includes(project.id));
    if (!api || !selected.length || !window.confirm(t("directory.confirmBulkRemove", { count: selected.length }))) return;
    for (const project of selected) { try { await api.projects.removeFromDirectory(project.id); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return; } }
    onProjectsChange(projects.filter((project) => !selectedIds.includes(project.id))); setSelectedIds([]);
  };
  const deleteSelected = async () => {
    const selected = projects.filter((project) => selectedIds.includes(project.id));
    if (!api || !selected.length || !window.confirm(t("directory.confirmBulkDelete", { count: selected.length, paths: selected.map((project) => project.canonicalPath).join("\n") }))) return;
    for (const project of selected) { try { await api.projects.deleteToRecycleBin(project.id, project.canonicalPath); onProjectsChange((current) => current.filter((item) => item.id !== project.id)); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return; } }
    setSelectedIds([]);
  };

  return <div className="app-shell project-directory-v044"><header className="directory-topbar">
    <div className="brand-lockup compact"><div className="brand-mark"><WeaveLogo size={28}/></div><div className="brand-name">{t("app.name")}</div></div>
    <label className="directory-global-search"><SearchIcon/><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("directory.search")}/><kbd>Ctrl K</kbd></label>
    <div className="directory-actions">
      <div className="directory-popover-anchor"><button className="connection-pill directory-workspace-button" onClick={() => setWorkspaceMenuOpen((open) => !open)}><span className="status-dot"/>{t("project.local")}<ChevronIcon/></button>{workspaceMenuOpen && <div className="directory-popover workspace-popover"><div className="workspace-popover-local"><strong>{t("project.local")}</strong><small>{t("directory.localCount", { count: projects.length })}</small><span>{t("directory.localWorkspaceHint")}</span></div><div className="workspace-popover-divider"/><div className="workspace-popover-cloud" aria-disabled="true"><span><i className="workspace-popover-cloud-dot" aria-hidden="true"/><strong>{t("project.cloud")}</strong></span><small>{t("directory.workspaceComingSoon")}</small></div></div>}</div>
      <div className="directory-popover-anchor directory-new-control"><button className="primary-button directory-new-main" onClick={() => setCreateOpen(true)}><PlusIcon/>{t("project.new")}</button><button className="primary-button directory-new-toggle" aria-label={t("directory.moreCreateOptions")} onClick={() => setMenuOpen((open) => !open)}><ChevronIcon/></button>{menuOpen && <div className="new-menu directory-popover"><button onClick={() => { setCreateOpen(true); setMenuOpen(false); }}><span className="menu-icon"><PlusIcon/></span><span><strong>{t("project.new")}</strong><small>{t("directory.createNewHint")}</small></span></button><button onClick={() => void registerFolder()}><span className="menu-icon"><FolderIcon/></span><span><strong>{t("project.openFolder")}</strong><small>{t("directory.openFolderHint")}</small></span></button></div>}</div>
      <button className="secondary-button directory-import" onClick={() => void registerFolder()}><FolderIcon/>{t("directory.import")}</button>
      <button className="icon-button directory-library" onClick={onOpenLibrary} title={t("activity.library")} aria-label={t("activity.library")}>◈</button>
      <button className="icon-button" onClick={() => setSettingsOpen(true)} title={t("activity.settings")} aria-label={t("activity.settings")}><GearIcon/></button>
    </div>
  </header>
  <main className="directory-main">
    <section className="directory-heading"><div><h1>{t("directory.projects")}</h1><p>{t("directory.localCount", { count: projects.length })}</p></div></section>
    <section className="directory-controls"><nav className="directory-tabs" aria-label={t("directory.projectFilters")}>
      {(["all", "pinned", "favorites", "recent"] as const).map((tab) => <button key={tab} className={preferences.tab === tab ? "active" : ""} onClick={() => { setPreferences((value) => ({ ...value, tab })); setSelectedIds([]); }}><span>{t(`directory.tab.${tab}`)}</span><small>{counts[tab]}</small></button>)}
    </nav><div className="directory-view-controls"><label><span>↕</span><select aria-label={t("directory.sort")} value={preferences.sort} onChange={(event) => setPreferences((value) => ({ ...value, sort: event.target.value as DirectorySort }))}><option value="lastOpened">{t("directory.sort.lastOpened")}</option><option value="name">{t("directory.sort.name")}</option><option value="dateAdded">{t("directory.sort.dateAdded")}</option></select></label><button className="directory-direction" title={preferences.direction === "desc" ? t("directory.descending") : t("directory.ascending")} aria-label={preferences.direction === "desc" ? t("directory.descending") : t("directory.ascending")} onClick={() => setPreferences((value) => ({ ...value, direction: value.direction === "desc" ? "asc" : "desc" }))}>{preferences.direction === "desc" ? "↓" : "↑"}</button><div className="density-switch"><button className={preferences.density === "compact" ? "active" : ""} title={t("directory.compact")} onClick={() => setPreferences((value) => ({ ...value, density: "compact" }))}>☰</button><button className={preferences.density === "comfortable" ? "active" : ""} title={t("directory.comfortable")} onClick={() => setPreferences((value) => ({ ...value, density: "comfortable" }))}>▤</button></div></div></section>
    {selectedIds.length > 0 && <div className="directory-bulk-bar"><strong>{t("directory.selected", { count: selectedIds.length })}</strong><button onClick={() => void updateMany({ isPinned: !projects.filter((project) => selectedIds.includes(project.id)).every((project) => directoryMetadata(project).isPinned) })}>{t("directory.pin")}</button><button onClick={() => void updateMany({ isFavorite: !projects.filter((project) => selectedIds.includes(project.id)).every((project) => directoryMetadata(project).isFavorite) })}>{t("directory.favorite")}</button><button onClick={() => void removeSelected()}>{t("directory.removeFromList")}</button><button className="danger" disabled={projects.some((project) => selectedIds.includes(project.id) && project.missing)} onClick={() => void deleteSelected()}>{t("directory.deleteFromDisk")}</button><button className="bulk-clear" onClick={() => setSelectedIds([])}>{t("common.close")}</button></div>}
    {error && <div className="inline-error directory-error">{error}<button onClick={() => setError(undefined)}>{t("common.close")}</button></div>}
    <section className={`directory-table-card density-${preferences.density}`}>
      <div className="directory-table-head"><label className="directory-check"><input type="checkbox" aria-label={t("directory.selectAll")} checked={filtered.length > 0 && filtered.every((project) => selectedIds.includes(project.id))} onChange={(event) => setSelectedIds(event.target.checked ? filtered.map((project) => project.id) : [])}/></label><span>{t("project.name")}</span><span>{t("directory.mainFile")}</span><span>{t("project.location")}</span><span>{t("directory.lastOpened")}</span><span aria-label={t("directory.favorite")}>☆</span><span aria-label={t("directory.pin")}>⌖</span><span/></div>
      <div className="directory-project-list" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); setSelectedIds(filtered.map((project) => project.id)); } else if (event.key === "Delete" && selectedIds.length) { event.preventDefault(); void removeSelected(); } else if (event.key === "Escape") { setSelectedIds([]); setMenuProjectId(undefined); } }}>
        {filtered.map((project) => { const meta = directoryMetadata(project); const avatarColor = projectAvatarPalette.find((color) => color.foreground === meta.avatarColor) ?? projectAvatarPalette[0]; const selected = selectedIds.includes(project.id); return <div role="row" tabIndex={0} aria-selected={selected} className={`directory-project-row ${selected ? "selected" : ""} ${project.missing ? "missing" : ""}`} key={project.id} onClick={(event) => { if (!(event.target instanceof Element) || !event.target.closest("button, input, .project-action-menu")) openProjectEntry(project); }} onContextMenu={(event) => { event.preventDefault(); if (!selected) setSelectedIds([project.id]); setMenuProjectId(project.id); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); openProjectEntry(project); } }}>
          <label className="directory-check" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={t("directory.selectProject", { name: meta.displayName })} checked={selected} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...new Set([...ids, project.id])] : ids.filter((id) => id !== project.id))}/></label>
          <span className="directory-project-name"><span className="directory-avatar" style={{ "--directory-avatar-foreground": avatarColor.foreground, "--directory-avatar-background": avatarColor.background } as CSSProperties}>{meta.avatarLetter}</span><span className="directory-name-text"><strong title={meta.displayName}>{meta.displayName}</strong><small>{project.missing ? t("directory.locationMissing") : project.mainFileMissing ? t("directory.mainFileMissing") : project.mainFile ?? t("directory.noMainFile")}</small></span></span>
          <span className={`directory-main-file ${project.mainFileMissing ? "missing-main" : project.mainFile ? "" : "muted"}`} title={project.mainFile ?? ""}>{project.mainFile ? <><span className="directory-file-icon">{project.mainFileMissing ? "!" : "Tₓ"}</span>{project.mainFile}</> : t("directory.notSet")}</span>
          <span className="directory-location" title={project.canonicalPath}><FolderIcon/><span>{project.canonicalPath}</span></span>
          <span className="directory-last-opened">{formatLastOpened(project)}</span>
          <button className={`directory-state-button favorite ${meta.isFavorite ? "active" : ""}`} title={meta.isFavorite ? t("directory.removeFavorite") : t("directory.addFavorite")} aria-label={meta.isFavorite ? t("directory.removeFavorite") : t("directory.addFavorite")} onClick={(event) => { event.stopPropagation(); void updateEntry(project, { isFavorite: !meta.isFavorite }); }}>{meta.isFavorite ? "★" : "☆"}</button>
          <button className={`directory-state-button pin ${meta.isPinned ? "active" : ""}`} title={meta.isPinned ? t("directory.unpin") : t("directory.pin")} aria-label={meta.isPinned ? t("directory.unpin") : t("directory.pin")} onClick={(event) => { event.stopPropagation(); void updateEntry(project, { isPinned: !meta.isPinned }); }}>{meta.isPinned ? "📌" : "⌖"}</button>
          <div className="directory-row-menu directory-popover-anchor"><button className="directory-more" aria-label={t("directory.moreActions")} onClick={(event) => { event.stopPropagation(); openProjectMenu(project); }}>⋯</button>{menuProjectId === project.id && <div className="project-action-menu directory-popover" onClick={(event) => event.stopPropagation()}><button disabled={project.missing} onClick={() => void performProjectMenuAction("open", project)}>{t("directory.open")}</button>{project.missing && <button onClick={() => void locateProject(project)}>{t("directory.locate")}</button>}<button disabled={project.missing} onClick={() => void performProjectMenuAction("reveal", project)}>{t("directory.reveal")}</button><button onClick={() => void performProjectMenuAction("copy", project)}>{t("directory.copyPath")}</button><button onClick={() => void performProjectMenuAction("rename", project)}>{t("directory.renameDisplayName")}</button><button onClick={() => void performProjectMenuAction("favorite", project)}>{meta.isFavorite ? t("directory.removeFavorite") : t("directory.addFavorite")}</button><button onClick={() => void performProjectMenuAction("pin", project)}>{meta.isPinned ? t("directory.unpin") : t("directory.pin")}</button><button onClick={() => void performProjectMenuAction("remove", project)}>{t("directory.removeFromList")}</button><button className="danger" disabled={project.missing} onClick={() => void performProjectMenuAction("delete", project)}>{t("directory.deleteFromDisk")}</button></div>}</div>
        </div>; })}
        {filtered.length === 0 && <div className="directory-empty"><div className="empty-icon"><FolderIcon/></div><strong>{query ? t("directory.noSearchResults") : projects.length ? t("directory.noFilterResults") : t("project.empty")}</strong><span>{projects.length === 0 ? t("project.emptyHint") : t("directory.emptyHint")}</span>{projects.length === 0 && <div><button className="primary-button" onClick={() => setCreateOpen(true)}><PlusIcon/>{t("project.new")}</button><button className="secondary-button" onClick={() => void registerFolder()}><FolderIcon/>{t("project.openFolder")}</button></div>}</div>}
      </div>
      <footer className="directory-result-count">{t("directory.showingResults", { shown: filtered.length, total: projects.length })}</footer>
    </section>
    <footer className="dashboard-footer directory-footer"><span><span className="status-dot"/>{t("project.savedLocally")}</span><span>{t("app.name")} {t("app.version")}</span></footer>
  </main>
  {createOpen && <div className="modal-backdrop"><section className="modal-card project-creation-card"><div className="modal-heading"><div><p className="eyebrow">{t("common.projectSetup")}</p><h2>{t("project.createTitle")}</h2></div><button className="close-button" onClick={() => setCreateOpen(false)}>×</button></div><label className="field-label">{t("project.name")}<input autoFocus value={name} onChange={(event) => setName(event.target.value)}/></label><label className="field-label">{t("project.parent")}<div className="path-input"><input value={parentPath} onChange={(event) => setParentPath(event.target.value)}/><button onClick={() => void chooseFolder()}><FolderIcon/>{t("project.browse")}</button></div></label><ProjectStyleResourcePicker styleResources={styleResources} baseResource={baseResource} setBaseResource={setBaseResource} extraResources={extraResources} setExtraResources={setExtraResources}/><div className="modal-actions"><button className="secondary-button" onClick={() => setCreateOpen(false)}>{t("project.cancel")}</button><button className="primary-button" disabled={busy} onClick={() => void createProject()}>{t(busy ? "project.creating" : "project.create")}</button></div></section></div>}
    {settingsOpen && <SettingsDialog onClose={() => { setSettingsOpen(false); void onRefreshResources(); }}/>} 

  </div>;
}

export function App() {
  const store = useSettings();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project>();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [compilerSettings, setCompilerSettings] = useState(false);
  const [styleResources, setStyleResources] = useState<StyleResource[]>([]);
  const configured = store.global("environments") as EnvironmentDefinition[];
  const environments = configured.length ? includeNewBuiltInEnvironments(configured) : DEFAULT_ENVIRONMENTS;
  const refreshStyleResources = async () => { const next = await window.latexEditor!.styleResources.list(); setStyleResources(next); };
  const openProject = async (project: Project) => {
    const opened = await window.latexEditor!.projects.open(project.id);
    setProjects(await window.latexEditor!.projects.list());
    await settings.load(project.id);
    await settings.set("lastProject", project.id);
    setActiveProject(opened);
  };
  useEffect(() => {
    let cancelled = false;
    void window.latexEditor!.projects.list().then(async (items) => {
      if (cancelled) return;
      setProjects(items);
      const last = items.find((item) => item.id === store.global("lastProject"));
      if (store.global("restoreProject") && last) await openProject(last);
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { void refreshStyleResources(); }, []);
  useEffect(() => window.latexEditor!.projects.onUpdate(updated => {
    setProjects(current => current.map(project => project.id === updated.id ? updated : project));
    setActiveProject(current => current?.id === updated.id ? updated : current);
  }), []);
  useEffect(installShortcuts, []);
  useEffect(() => installWheelAcceleration(() => settings.global("wheelAcceleration")), []);
  useEffect(() => {
    const lifecycle = window.latexEditor?.lifecycle;
    if (!lifecycle) return;
    return lifecycle.onCloseRequested((requestId) => {
      void resolveExit(unsavedChanges, {
        confirm: () => lifecycle.confirmClose({ title: t("exit.title"), message: t("exit.message"), detail: t("exit.detail"), buttons: [t("exit.save"), t("exit.discard"), t("exit.cancel")] }),
        flush: flushSync,
        reportError: (error) => lifecycle.showSaveError(t("exit.failedTitle"), `${t("exit.failedMessage")}\n\n${error instanceof Error ? error.message : String(error)}`)
      }).then((allow) => lifecycle.completeClose(requestId, allow)).catch(() => lifecycle.completeClose(requestId, false));
    });
  }, []);
  const onHome = () => { void settings.load().then(() => setActiveProject(undefined)); };
  return <><ThemeRuntime />{activeProject && <div style={{ position: "fixed", inset: 0, overflow: "hidden", display: libraryOpen ? "none" : undefined }}><Workbench key={activeProject.id} project={activeProject} projects={projects} environments={environments} onHome={onHome} onSwitch={(project) => void openProject(project)} onOpenLibrary={() => setLibraryOpen(true)}/></div>}
    {!activeProject && !libraryOpen && <ProjectDirectory projects={projects} onProjectsChange={setProjects} onOpen={(project) => void openProject(project)} onOpenLibrary={() => setLibraryOpen(true)} styleResources={styleResources} onRefreshResources={refreshStyleResources}/>}
    {libraryOpen && <div className="app-shell library-app-shell" style={{ position: "fixed", inset: 0, zIndex: 40, overflow: "auto" }}><ReferenceLibraryPage projects={projects} returnToProject={Boolean(activeProject)} onBack={() => setLibraryOpen(false)}/></div>}
    {!warningDismissed && store.snapshot().toolchain && store.snapshot().toolchain?.overallStatus !== "ready" && <aside className="toolchain-warning"><p>{store.snapshot().toolchain?.overallStatus === "limited" ? t("settings.limitedToolchain") : t("settings.missingToolchain")}</p><button onClick={() => void store.detect()}>{t("settings.detect")}</button><button onClick={() => void store.detect("directory")}>{t("settings.locate")}</button><button onClick={() => { setCompilerSettings(true); setWarningDismissed(true); }}>{t("settings.openCompiler")}</button><button onClick={() => setWarningDismissed(true)}>{t("common.close")}</button></aside>}
    {compilerSettings && <SettingsDialog initial="compiler" onClose={() => setCompilerSettings(false)}/>}
  </>;
}
