import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Project, StyleResource } from "@latex-editor/contracts";
import { t } from "./i18n/index.js";
import { Workbench } from "./workbench/Workbench.js";
import { useSettings, settings } from "./settings/service.js";
import { SettingsDialog } from "./settings/SettingsDialog.js";
import { commands, installShortcuts } from "./settings/commands.js";
import { DEFAULT_ENVIRONMENTS } from "./preview/environments.js";
import type { EnvironmentDefinition } from "./preview/types.js";

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

function formatUpdated(project: Project): string {
  const value = project.lastEditedAt ?? project.lastOpenedAt ?? project.registeredAt;
  if (!value) return "—";
  const date = new Date(value);
  if (new Date().toDateString() === date.toDateString()) return t("project.today");
  return date.toLocaleDateString();
}

function ProjectDirectory({ projects, onProjectsChange, onOpen, styleResources, onRefreshResources }: { projects: Project[]; onProjectsChange(projects: Project[]): void; onOpen(project: Project): void; styleResources: StyleResource[]; onRefreshResources(): Promise<void> }) {
  useSettings();
  useEffect(() => commands.register("settings.open", { execute: () => setSettingsOpen(true) }), []);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [parentPath, setParentPath] = useState("");
  const [baseResource, setBaseResource] = useState("default");
  const [extraResources, setExtraResources] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const api = window.latexEditor;
  const filtered = useMemo(() => projects.filter((project) => `${project.name} ${project.canonicalPath}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [projects, query]);
  useEffect(() => {
    if (!menuOpen) return;
    const closeWhenOutside = (event: MouseEvent) => { if (!(event.target instanceof Element) || !event.target.closest(".new-control")) setMenuOpen(false); };
    document.addEventListener("mousedown", closeWhenOutside);
    return () => document.removeEventListener("mousedown", closeWhenOutside);
  }, [menuOpen]);

  const chooseFolder = async () => { const folder = await api?.dialogs.pickFolder(); if (folder) setParentPath(folder); };
  const registerFolder = async () => { setMenuOpen(false); const folder = await api?.dialogs.pickFolder(); if (!folder || !api) return; setBusy(true); try { const project = await api.projects.register(folder); onProjectsChange([project, ...projects]); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };
  const createProject = async () => { if (!api || !name.trim() || !parentPath.trim()) return; setBusy(true); try { const project = await api.projects.create({ name: name.trim(), parentPath: parentPath.trim(), styleResourceIds: [baseResource, ...extraResources] }); onProjectsChange([project, ...projects]); setCreateOpen(false); setName(""); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };

  return <div className="app-shell"><header className="topbar"><div className="brand-lockup"><div className="brand-mark"><WeaveLogo/></div><div><div className="brand-name">{t("app.name")}</div><div className="brand-caption">{t("app.tagline")}</div></div></div><div className="topbar-actions"><span className="connection-pill"><span className="status-dot"/>{t("project.local")}</span><button className="icon-button" onClick={() => setSettingsOpen(true)} title={t("activity.settings")}><GearIcon/></button></div></header><main className="dashboard"><section className="welcome-row"><div><p className="eyebrow">{t("app.tagline")}</p><h1>{t("project.directory")}</h1><p className="lead">{t("project.directoryHint")}</p></div><div className="workspace-orbit"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><span>{projects.length.toString().padStart(2, "0")}</span><small>{t("project.directory")}</small></div></section><section className="toolbar"><label className="search-box"><SearchIcon/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("project.search")}/></label><div className="new-control"><button className="primary-button" onClick={() => setCreateOpen(true)}><PlusIcon/>{t("project.new")}</button><button className="primary-button dropdown-toggle" onClick={() => setMenuOpen(!menuOpen)}><ChevronIcon/></button>{menuOpen && <div className="new-menu"><button onClick={() => { setCreateOpen(true); setMenuOpen(false); }}><span className="menu-icon"><PlusIcon/></span><strong>{t("project.new")}</strong></button><button onClick={() => void registerFolder()}><span className="menu-icon"><FolderIcon/></span><strong>{t("project.openFolder")}</strong></button></div>}</div></section>{error && <div className="inline-error">{error}<button onClick={() => setError(undefined)}>{t("common.close")}</button></div>}<section className="project-card"><div className="table-head"><span className="check-box"/><span>{t("project.name")}</span><span>{t("project.location")}</span><span>{t("project.updated")}</span></div>{filtered.length ? <div className="project-list">{filtered.map((project) => <button className="project-row" key={project.id} onClick={() => onOpen(project)}><span className="check-box"/><span className="project-name-cell"><span className="project-avatar">{project.name.slice(0, 1).toUpperCase()}</span><span><strong>{project.name}</strong><small>{project.mainFile ?? "—"}</small></span></span><span className="location-cell"><FolderIcon/><span>{project.canonicalPath}</span></span><span className="updated-cell">{formatUpdated(project)}</span></button>)}</div> : <div className="empty-state"><div className="empty-icon"><FolderIcon/></div><h2>{t("project.empty")}</h2><p>{t("project.emptyHint")}</p></div>}</section><footer className="dashboard-footer"><span><span className="status-dot"/>{t("project.savedLocally")}</span><span>{t("app.name")} {t("app.version")}</span></footer></main>
    {createOpen && <div className="modal-backdrop"><section className="modal-card project-creation-card"><div className="modal-heading"><div><p className="eyebrow">{t("common.projectSetup")}</p><h2>{t("project.createTitle")}</h2></div><button className="close-button" onClick={() => setCreateOpen(false)}>×</button></div><label className="field-label">{t("project.name")}<input autoFocus value={name} onChange={(event) => setName(event.target.value)}/></label><label className="field-label">{t("project.parent")}<div className="path-input"><input value={parentPath} onChange={(event) => setParentPath(event.target.value)}/><button onClick={() => void chooseFolder()}><FolderIcon/>{t("project.browse")}</button></div></label><fieldset className="resource-picker"><legend>{t("resource.choose")}</legend><p>{t("resource.chooseHint")}</p>{styleResources.filter((resource) => resource.source === "built-in").map((resource) => <label key={resource.id}><input type="radio" name="base-style" checked={baseResource === resource.id} onChange={() => setBaseResource(resource.id)}/><span><strong>{resource.name}</strong><small>{resource.description}</small></span></label>)}{styleResources.filter((resource) => resource.source === "user").map((resource) => <label key={resource.id}><input type="checkbox" checked={extraResources.includes(resource.id)} onChange={(event) => setExtraResources((current) => event.target.checked ? [...current, resource.id] : current.filter((id) => id !== resource.id))}/><span><strong>{resource.name}</strong><small>{t("resource.custom")}</small></span></label>)}</fieldset><div className="modal-actions"><button className="secondary-button" onClick={() => setCreateOpen(false)}>{t("project.cancel")}</button><button className="primary-button" disabled={busy} onClick={() => void createProject()}>{t(busy ? "project.creating" : "project.create")}</button></div></section></div>}
    {settingsOpen && <SettingsDialog onClose={() => { setSettingsOpen(false); void onRefreshResources(); }}/>} 

  </div>;
}

export function App() {
  const store = useSettings();
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project>();
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [compilerSettings, setCompilerSettings] = useState(false);
  const [styleResources, setStyleResources] = useState<StyleResource[]>([]);
  const configured = store.global("environments") as EnvironmentDefinition[];
  const environments = configured.length ? configured : DEFAULT_ENVIRONMENTS;
  const refreshStyleResources = async () => { const next = await window.latexEditor!.styleResources.list(); setStyleResources(next); };
  const openProject = async (project: Project) => {
    const opened = await window.latexEditor!.projects.open(project.id);
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
  useEffect(installShortcuts, []);
  const onHome = () => { void settings.load().then(() => setActiveProject(undefined)); };
  return <>{activeProject
    ? <Workbench key={activeProject.id} project={activeProject} projects={projects} environments={environments} onHome={onHome} onSwitch={(project) => void openProject(project)}/>
    : <ProjectDirectory projects={projects} onProjectsChange={setProjects} onOpen={(project) => void openProject(project)} styleResources={styleResources} onRefreshResources={refreshStyleResources}/>} 
    {!warningDismissed && !store.snapshot().toolchain?.available && <aside className="toolchain-warning"><p>{t("settings.missingToolchain")}</p><button onClick={() => void store.detect()}>{t("settings.detect")}</button><button onClick={() => void store.detect("directory")}>{t("settings.locate")}</button><button onClick={() => { setCompilerSettings(true); setWarningDismissed(true); }}>{t("settings.openCompiler")}</button><button onClick={() => setWarningDismissed(true)}>{t("common.close")}</button></aside>}
    {compilerSettings && <SettingsDialog initial="compiler" onClose={() => setCompilerSettings(false)}/>}
  </>;
}
