import type { AIStatus, AIModelOption, AIConversation, AIChangeSet, AIContextSnapshotFile, AIProjectSkill, AIMode, AIAttachment, AddSemanticBlockInput, BlockCreationValidation, BlockGraphSnapshot, BlockId, BlockRangeMappingResult, BlockReconciliationResult, CommandMetadata, CompileResult, PdfExportResult, CreateSemanticBlockInput, CreateUserBlockInput, DependencyCycle, DictionaryPackage, FileWriteResult, GraphDiagnostic, GraphTraversalOptions, GraphTraversalResult, ImportedImage, LogicalRelation, MapUserBlockRangesInput, Project, ProjectHistoryDetails, ProjectHistoryEntry, ProjectHistoryStorage, ProjectTreeNode, ReconcileParsedBlocksInput, RelationDirection, RelationMutationResult, RelationNeighborhood, RelationValidation, ResolvedGraphic, SemanticBlock, SettingsSnapshot, PreferenceKey, LatexToolchain, StyleResource, ThemeDefinition, SnapshotReason, SpellCheckMode, SpellCheckStatus, StructuralDependencyOverlap, StructuralHistoryState, StructureWarning, SyncTexPdfPosition, SyncTexSourcePosition, TextFileContent, UpdateSemanticBlockInput, ProjectReferenceLink, ReferenceLibraryEntry, ReferenceLibrarySnapshot, ReferenceImportResult, ReferenceTag } from "./index.js" with { "resolution-mode": "import" };

import type { BlockApiResult, DocumentBlockApi, DocumentStructure, AIApprovalRequest } from "./index.js" with { "resolution-mode": "import" };

import type { InstallationState, InstalledComponent, RemoveUserDataOptions } from "./installation.js" with { "resolution-mode": "import" };

/** A request descriptor owns its wire name, arguments and resolved result. */
export interface InvokeEndpoint<F> {
  readonly channel: string;
  /** Type-only signature; never transported across Electron. */
  readonly signature?: F;
}
const invoke = <F extends (...args: never[]) => Promise<unknown>>(channel: string): InvokeEndpoint<F> => ({ channel });
type ProjectScoped<F extends (...args: never[]) => Promise<unknown>> = (projectId: string, ...args: Parameters<F>) => ReturnType<F>;

/** Desktop transport contract. Existing public method and wire names remain stable. */
export const desktopInvoke = {
  structure: {
    snapshot: invoke<(projectId: string) => Promise<BlockApiResult<DocumentStructure>>>("structure:snapshot"),
    list_blocks: invoke<ProjectScoped<DocumentBlockApi["list_blocks"]>>("structure:list_blocks"),
    find_blocks: invoke<ProjectScoped<DocumentBlockApi["find_blocks"]>>("structure:find_blocks"),
    get_block: invoke<ProjectScoped<DocumentBlockApi["get_block"]>>("structure:get_block"),
    get_blocks: invoke<ProjectScoped<DocumentBlockApi["get_blocks"]>>("structure:get_blocks"),
    get_block_source: invoke<ProjectScoped<DocumentBlockApi["get_block_source"]>>("structure:get_block_source"),
    replace_block_content: invoke<ProjectScoped<DocumentBlockApi["replace_block_content"]>>("structure:replace_block_content"),
    insert_block: invoke<ProjectScoped<DocumentBlockApi["insert_block"]>>("structure:insert_block"),
    delete_block: invoke<ProjectScoped<DocumentBlockApi["delete_block"]>>("structure:delete_block"),
    set_block_semantic: invoke<ProjectScoped<DocumentBlockApi["set_block_semantic"]>>("structure:set_block_semantic"),
  } satisfies { [K in keyof DocumentBlockApi]: InvokeEndpoint<ProjectScoped<DocumentBlockApi[K]>> } & {
    snapshot: InvokeEndpoint<(projectId: string) => Promise<BlockApiResult<DocumentStructure>>>;
  },
  lifecycle: {
    confirmClose: invoke<(labels: { title: string; message: string; detail: string; buttons: [string, string, string] }) => Promise<"save" | "discard" | "cancel">>("window:confirm-close"),
    showSaveError: invoke<(title: string, message: string) => Promise<void>>("window:save-error"),
  },
  settings: {
    get: invoke<(projectId?: string) => Promise<SettingsSnapshot>>("settings:get"),
    set: invoke<(key: PreferenceKey, value: unknown, projectId?: string) => Promise<SettingsSnapshot>>("settings:set"),
    detectToolchain: invoke<(manual?: "directory" | "executable") => Promise<LatexToolchain | undefined>>("toolchain:detect"),
  },
  installation: {
    state: invoke<() => Promise<InstallationState | undefined>>("installation:state"),
    setMode: invoke<(mode: "recommended" | "custom", installDirectory?: string) => Promise<InstallationState | undefined>>("installation:set-mode"),
    recordComponent: invoke<(component: Omit<InstalledComponent, "installedAt">) => Promise<InstallationState | undefined>>("installation:record-component"),
    recordEnvironment: invoke<(toolchain: LatexToolchain) => Promise<InstallationState | undefined>>("installation:record-environment"),
    removeUserData: invoke<(options: RemoveUserDataOptions) => Promise<void>>("installation:remove-user-data"),
  },
  resources: {
    searchCommands: invoke<(query: string) => Promise<CommandMetadata[]>>("resources:commands"),
  },
  references: {
    snapshot: invoke<(projectId?: string) => Promise<ReferenceLibrarySnapshot | undefined>>("references:snapshot"),
    importFile: invoke<(path: string) => Promise<ReferenceImportResult>>("references:import-file"),
    saveEntry: invoke<(entry: Partial<ReferenceLibraryEntry> & Pick<ReferenceLibraryEntry, "citationKey" | "entryType" | "fields">) => Promise<ReferenceLibraryEntry>>("references:save-entry"),
    removeEntry: invoke<(id: string) => Promise<void>>("references:remove-entry"),
    setFavorite: invoke<(id: string, favorite: boolean) => Promise<void>>("references:set-favorite"),
    createCollection: invoke<(name: string, parentId?: string) => Promise<{ id: string; name: string; parentId?: string }>>("references:create-collection"),
    createTag: invoke<(name: string) => Promise<ReferenceTag>>("references:create-tag"),
    renameTag: invoke<(id: string, name: string) => Promise<ReferenceTag>>("references:rename-tag"),
    removeTag: invoke<(id: string) => Promise<void>>("references:remove-tag"),
    setProjectLink: invoke<(link: ProjectReferenceLink) => Promise<void>>("references:set-project-link"),
    removeProjectLink: invoke<(projectId: string, entryId: string) => Promise<void>>("references:remove-project-link"),
  },
  // Relationship graph API. Block/range/tree methods remain for existing editor
  // callers; new source-aware consumers use structure and DocumentBlockApi.
  blockGraph: {
    snapshot: invoke<(projectId: string) => Promise<BlockGraphSnapshot>>("block-graph:snapshot"),
    createBlock: invoke<(projectId: string, input: CreateSemanticBlockInput) => Promise<SemanticBlock>>("block-graph:create-block"),
    validateUserBlock: invoke<(projectId: string, input: CreateUserBlockInput) => Promise<BlockCreationValidation>>("block-graph:validate-user-block"),
    createUserBlock: invoke<(projectId: string, input: CreateUserBlockInput) => Promise<SemanticBlock>>("block-graph:create-user-block"),
    deleteUserBlock: invoke<(projectId: string, blockId: BlockId) => Promise<void>>("block-graph:delete-user-block"),
    reconcileParsedBlocks: invoke<(projectId: string, input: ReconcileParsedBlocksInput) => Promise<BlockReconciliationResult>>("block-graph:reconcile-parsed"),
    mapUserBlockRanges: invoke<(projectId: string, input: MapUserBlockRangesInput) => Promise<BlockRangeMappingResult>>("block-graph:map-user-ranges"),
    addBlock: invoke<(projectId: string, block: AddSemanticBlockInput & { id: BlockId }) => Promise<void>>("block-graph:add-block"),
    updateBlock: invoke<(projectId: string, blockId: BlockId, patch: UpdateSemanticBlockInput) => Promise<SemanticBlock>>("block-graph:update-block"),
    removeBlock: invoke<(projectId: string, blockId: BlockId) => Promise<void>>("block-graph:remove-block"),
    addDependency: invoke<(projectId: string, prerequisite: BlockId, consequence: BlockId) => Promise<RelationMutationResult>>("block-graph:add-dependency"),
    validateDependency: invoke<(projectId: string, prerequisite: BlockId, consequence: BlockId) => Promise<RelationValidation>>("block-graph:validate-dependency"),
    removeDependency: invoke<(projectId: string, prerequisite: BlockId, consequence: BlockId) => Promise<void>>("block-graph:remove-dependency"),
    hasDirectDependency: invoke<(projectId: string, prerequisite: BlockId, consequence: BlockId) => Promise<boolean>>("block-graph:has-direct-dependency"),
    setStructuralParent: invoke<(projectId: string, child: BlockId, parent: BlockId | null) => Promise<void>>("block-graph:set-structural-parent"),
    getDirectPrerequisites: invoke<(projectId: string, blockId: BlockId) => Promise<BlockId[]>>("block-graph:direct-prerequisites"),
    getDirectConsequences: invoke<(projectId: string, blockId: BlockId) => Promise<BlockId[]>>("block-graph:direct-consequences"),
    getPrerequisiteClosure: invoke<(projectId: string, blockId: BlockId, options?: GraphTraversalOptions) => Promise<GraphTraversalResult>>("block-graph:prerequisite-closure"),
    getConsequenceClosure: invoke<(projectId: string, blockId: BlockId, options?: GraphTraversalOptions) => Promise<GraphTraversalResult>>("block-graph:consequence-closure"),
    isPrerequisiteOf: invoke<(projectId: string, prerequisite: BlockId, consequence: BlockId) => Promise<boolean>>("block-graph:is-prerequisite-of"),
    getStructuralParent: invoke<(projectId: string, blockId: BlockId) => Promise<BlockId | null>>("block-graph:structural-parent"),
    getStructuralChildren: invoke<(projectId: string, blockId: BlockId) => Promise<BlockId[]>>("block-graph:structural-children"),
    getStructuralAncestors: invoke<(projectId: string, blockId: BlockId) => Promise<BlockId[]>>("block-graph:structural-ancestors"),
    getStructuralDescendants: invoke<(projectId: string, blockId: BlockId) => Promise<BlockId[]>>("block-graph:structural-descendants"),
    isStructuralAncestor: invoke<(projectId: string, ancestor: BlockId, descendant: BlockId) => Promise<boolean>>("block-graph:is-structural-ancestor"),
    getStronglyConnectedComponents: invoke<(projectId: string) => Promise<BlockId[][]>>("block-graph:scc"),
    detectDependencyCycles: invoke<(projectId: string) => Promise<DependencyCycle[]>>("block-graph:cycles"),
    findStructuralOverlapsInPrerequisites: invoke<(projectId: string, blockId: BlockId) => Promise<StructuralDependencyOverlap[]>>("block-graph:prerequisite-overlaps"),
    findStructuralOverlapsInConsequences: invoke<(projectId: string, blockId: BlockId) => Promise<StructuralDependencyOverlap[]>>("block-graph:consequence-overlaps"),
    findLogicalRelationsWithinPrerequisites: invoke<(projectId: string, blockId: BlockId) => Promise<LogicalRelation[]>>("block-graph:prerequisite-relations"),
    getBlocksBetween: invoke<(projectId: string, start: BlockId, end: BlockId) => Promise<BlockId[]>>("block-graph:between"),
    getRelationNeighborhood: invoke<(projectId: string, focusId: BlockId | null, direction: RelationDirection, depth: number | "all") => Promise<RelationNeighborhood>>("block-graph:neighborhood"),
    historyState: invoke<(projectId: string) => Promise<StructuralHistoryState>>("block-graph:history-state"),
    undo: invoke<(projectId: string) => Promise<BlockGraphSnapshot>>("block-graph:undo"),
    redo: invoke<(projectId: string) => Promise<BlockGraphSnapshot>>("block-graph:redo"),
    validate: invoke<(projectId: string) => Promise<GraphDiagnostic[]>>("block-graph:validate"),
    validateStructure: invoke<(projectId: string) => Promise<StructureWarning[]>>("block-graph:validate-structure"),
  },
  spellcheck: {
    checkText: invoke<(text: string, language: string) => Promise<Array<{ word: string; start: number; end: number; suggestions: string[] }>>>("spellcheck:check-text"),
    status: invoke<() => Promise<SpellCheckStatus | undefined>>("spellcheck:status"),
    configure: invoke<(mode: SpellCheckMode, language: string) => Promise<SpellCheckStatus | undefined>>("spellcheck:configure"),
    checkWords: invoke<(words: string[], language: string) => Promise<string[]>>("spellcheck:check-words"),
    suggestions: invoke<(word: string, language: string) => Promise<string[]>>("spellcheck:suggestions"),
    addToDictionary: invoke<(word: string) => Promise<boolean>>("spellcheck:add-word"),
    dictionaryWords: invoke<() => Promise<string[]>>("spellcheck:dictionary-words"),
    listDictionaries: invoke<(query?: string) => Promise<DictionaryPackage[]>>("spellcheck:list-dictionaries"),
    refreshDictionaries: invoke<() => Promise<DictionaryPackage[]>>("spellcheck:refresh-dictionaries"),
    installDictionary: invoke<(id: string) => Promise<DictionaryPackage>>("spellcheck:install-dictionary"),
    removeDictionary: invoke<(id: string) => Promise<SpellCheckStatus | undefined>>("spellcheck:remove-dictionary"),
  },
  styleResources: {
    list: invoke<() => Promise<StyleResource[]>>("style-resources:list"),
    create: invoke<(name: string) => Promise<StyleResource>>("style-resources:create"),
    importFiles: invoke<(paths: string[], name?: string) => Promise<StyleResource>>("style-resources:import-files"),
    importFolder: invoke<(folderPath: string) => Promise<StyleResource>>("style-resources:import-folder"),
    addFiles: invoke<(id: string, paths: string[]) => Promise<StyleResource>>("style-resources:add-files"),
    duplicate: invoke<(id: string) => Promise<StyleResource>>("style-resources:duplicate"),
    rename: invoke<(id: string, name: string) => Promise<StyleResource>>("style-resources:rename"),
    remove: invoke<(id: string) => Promise<void>>("style-resources:remove"),
  },
  themes: {
    list: invoke<() => Promise<ThemeDefinition[]>>("themes:list"),
    directory: invoke<() => Promise<string>>("themes:directory"),
    importFiles: invoke<(paths: string[]) => Promise<ThemeDefinition[]>>("themes:import-files"),
    importFolder: invoke<(folderPath: string) => Promise<ThemeDefinition[]>>("themes:import-folder"),
    remove: invoke<(id: string) => Promise<void>>("themes:remove"),
  },
  projects: {
    list: invoke<() => Promise<Project[]>>("projects:list"),
    create: invoke<(input: { name: string; parentPath: string; styleResourceIds?: string[] }) => Promise<Project>>("projects:create"),
    register: invoke<(folderPath: string) => Promise<Project>>("projects:register"),
    open: invoke<(projectId: string) => Promise<Project>>("projects:open"),
    setMainFile: invoke<(projectId: string, relativePath: string) => Promise<Project>>("projects:set-main-file"),
    relocateInDirectory: invoke<(projectId: string, folderPath: string) => Promise<Project>>("projects:directory-relocate"),
    updateDirectoryEntry: invoke<(projectId: string, patch: { displayName?: string; isFavorite?: boolean; isPinned?: boolean; avatarLetter?: string; avatarColor?: string }) => Promise<Project>>("projects:directory-update"),
    removeFromDirectory: invoke<(projectId: string) => Promise<unknown>>("projects:directory-remove"),
    deleteToRecycleBin: invoke<(projectId: string, confirmedPath: string) => Promise<boolean>>("projects:directory-delete"),
    revealInFileManager: invoke<(projectId: string) => Promise<void>>("projects:directory-reveal"),
    copyProjectPath: invoke<(projectId: string) => Promise<void>>("projects:directory-copy-path"),
  },
  files: {
    tree: invoke<(projectId: string) => Promise<ProjectTreeNode[]>>("files:tree"),
    read: invoke<(projectId: string, relativePath: string) => Promise<TextFileContent>>("files:read"),
    readPdf: invoke<(projectId: string, relativePath: string) => Promise<string | undefined>>("files:read-pdf"),
    write: invoke<(projectId: string, relativePath: string, content: string) => Promise<FileWriteResult>>("files:write"),
    createFile: invoke<(projectId: string, relativePath: string) => Promise<void>>("files:create-file"),
    createDirectory: invoke<(projectId: string, relativePath: string) => Promise<void>>("files:create-directory"),
    rename: invoke<(projectId: string, fromRelativePath: string, toRelativePath: string) => Promise<void>>("files:rename"),
    copy: invoke<(projectId: string, fromRelativePath: string, toRelativePath: string) => Promise<void>>("files:copy"),
    import: invoke<(projectId: string, sourcePath: string, destinationRelativePath: string) => Promise<void>>("files:import"),
    remove: invoke<(projectId: string, relativePath: string) => Promise<void>>("files:remove"),
  },
  history: {
    list: invoke<(projectId: string) => Promise<ProjectHistoryEntry[]>>("history:list"),
    createVersion: invoke<(projectId: string, input: { versionNumber: string; title: string; summary?: string }) => Promise<ProjectHistoryEntry>>("history:create-version"),
    createTemporary: invoke<(projectId: string, input: { title: string; summary?: string }) => Promise<ProjectHistoryEntry>>("history:create-temporary"),
    snapshot: invoke<(projectId: string, reason: SnapshotReason, description?: string, overrides?: Array<{ path: string; content: string }>) => Promise<ProjectHistoryEntry | undefined>>("history:snapshot"),
    details: invoke<(projectId: string, entryId: string) => Promise<ProjectHistoryDetails>>("history:details"),
    readText: invoke<(projectId: string, entryId: string, path: string) => Promise<string | undefined>>("history:read-text"),
    restore: invoke<(projectId: string, entryId: string, paths?: string[]) => Promise<{ restored: string[]; safetySnapshotId?: string }>>("history:restore"),
    promote: invoke<(projectId: string, entryId: string, input: { versionNumber: string; title: string; summary?: string }) => Promise<ProjectHistoryEntry>>("history:promote"),
    editVersion: invoke<(projectId: string, entryId: string, input: { title: string; summary?: string }) => Promise<ProjectHistoryEntry>>("history:edit-version"),
    remove: invoke<(projectId: string, entryId: string) => Promise<void>>("history:remove"),
    storage: invoke<(projectId: string) => Promise<ProjectHistoryStorage>>("history:storage"),
    optimize: invoke<(projectId: string) => Promise<ProjectHistoryStorage>>("history:optimize"),
  },
  images: {
    pick: invoke<(multiple?: boolean) => Promise<string[]>>("images:pick"),
    import: invoke<(projectId: string, sourcePaths: string[], directory: string) => Promise<ImportedImage[]>>("images:import"),
    resolve: invoke<(projectId: string, texPath: string, requestedPath: string, graphicPaths?: string[]) => Promise<ResolvedGraphic>>("images:resolve"),
  },
  compile: {
    run: invoke<(projectId: string, mainFile?: string) => Promise<CompileResult & { pdfDataUrl?: string }>>("compile:run"),
  },
  exports: {
    sourceArchive: invoke<(projectId: string, mainFile?: string) => Promise<string | undefined>>("exports:source-archive"),
    mainTex: invoke<(projectId: string, mainFile: string) => Promise<string | undefined>>("exports:main-tex"),
    pdf: invoke<(projectId: string, mainFile: string) => Promise<PdfExportResult>>("exports:pdf"),
  },
  ai: {
    detect: invoke<() => Promise<AIStatus | undefined>>("ai:detect"),
    models: invoke<() => Promise<AIModelOption[] | undefined>>("ai:models"),
    install: invoke<() => Promise<AIStatus | undefined>>("ai:install"),
    status: invoke<() => Promise<AIStatus | undefined>>("ai:status"),
    login: invoke<() => Promise<AIStatus | undefined>>("ai:login"),
    logout: invoke<() => Promise<AIStatus | undefined>>("ai:logout"),
    setExecutable: invoke<(path: string) => Promise<AIStatus | undefined>>("ai:set-executable"),
    copilotStatus: invoke<() => Promise<AIStatus | undefined>>("ai:copilot:status"),
    installCopilot: invoke<() => Promise<AIStatus | undefined>>("ai:copilot:install"),
    loginCopilot: invoke<() => Promise<AIStatus | undefined>>("ai:copilot:login"),
    logoutCopilot: invoke<() => Promise<AIStatus | undefined>>("ai:copilot:logout"),
    copilotModels: invoke<() => Promise<AIModelOption[] | undefined>>("ai:copilot:models"),
    skills: invoke<() => Promise<AIProjectSkill[] | undefined>>("ai:skills"),
    saveSkill: invoke<(input: { name: string; content: string; create?: boolean }) => Promise<AIProjectSkill[] | undefined>>("ai:skill:save"),
    conversations: invoke<(projectId?: string) => Promise<{ conversations: AIConversation[]; changeSets: AIChangeSet[] } | undefined>>("ai:conversations"),
    createConversation: invoke<(mode: AIMode, projectId?: string) => Promise<AIConversation | undefined>>("ai:conversation:create"),
    setConversationMode: invoke<(id: string, mode: AIMode) => Promise<AIConversation | undefined>>("ai:conversation:mode"),
    renameConversation: invoke<(id: string, title: string) => Promise<AIConversation | undefined>>("ai:conversation:rename"),
    removeConversation: invoke<(id: string) => Promise<void>>("ai:conversation:remove"),
    resolveChangeSet: invoke<(id: string, decisions: Record<string, "accepted" | "rejected">, applied: boolean) => Promise<AIChangeSet | undefined>>("ai:change-set:resolve"),
    markChangeSetApplied: invoke<(id: string, hunkIds: string[], error?: string) => Promise<AIChangeSet | undefined>>("ai:change-set:applied"),
    approvals: invoke<(projectId?: string) => Promise<AIApprovalRequest[]>>("ai:approvals"),
    resolveApproval: invoke<(id: string, allow: boolean) => Promise<void>>("ai:approval:resolve"),
    send: invoke<(input: { conversationId: string; projectId?: string; content: string; contextText?: string; overrides?: AIContextSnapshotFile[]; attachmentIds?: string[] }) => Promise<{ conversation: AIConversation; taskId: string } | undefined>>("ai:send"),
    pickAttachments: invoke<(projectId: string) => Promise<AIAttachment[]>>("ai:attachments:pick"),
    cancel: invoke<(taskId: string) => Promise<void>>("ai:cancel"),
  },
  synctex: {
    forward: invoke<(projectId: string, sourceFile: string, pdfFile: string, line: number, column: number) => Promise<SyncTexPdfPosition>>("synctex:forward"),
    reverse: invoke<(projectId: string, pdfFile: string, page: number, x: number, y: number) => Promise<SyncTexSourcePosition>>("synctex:reverse"),
  },
  dialogs: {
    pickFolder: invoke<() => Promise<string | undefined>>("dialogs:pick-folder"),
    pickFiles: invoke<() => Promise<string[]>>("dialogs:pick-files"),
    pickThemeFiles: invoke<() => Promise<string[]>>("dialogs:pick-theme-files"),
    pickProjectFiles: invoke<() => Promise<string[]>>("dialogs:pick-project-files"),
    pickProjectFolders: invoke<() => Promise<string[]>>("dialogs:pick-project-folders"),
  },
} as const;

export interface EventEndpoint<Args extends unknown[]> {
  readonly channel: string;
  readonly signature?: (...args: Args) => void;
}
const event = <Args extends unknown[]>(channel: string): EventEndpoint<Args> => ({ channel });
/** Notifications in each direction are separate from invoke requests. */
export const desktopEvents = {
  toRenderer: {
    closeRequested: event<[requestId: string]>("window:close-requested"),
    aiUpdate: event<[update: { kind: "conversation" | "changes" | "approval"; payload: AIConversation | AIChangeSet | AIApprovalRequest }]>("ai:update"),
    aiStatus: event<[status: AIStatus]>("ai:status")
  },
  toMain: {
    closeReady: event<[]>("window:close-ready"),
    closeResponse: event<[requestId: string, allow: boolean]>("window:close-response")
  }
} as const;

export type DesktopInvokeApi = {
  [G in keyof typeof desktopInvoke]: {
    [M in keyof typeof desktopInvoke[G]]: typeof desktopInvoke[G][M] extends InvokeEndpoint<infer F> ? F : never
  }
};
/** Renderer surface includes explicit subscriptions and Electron's local File helper. */
export type DesktopApi = Omit<DesktopInvokeApi, "lifecycle" | "ai" | "files"> & {
  lifecycle: DesktopInvokeApi["lifecycle"] & {
    onCloseRequested(listener: NonNullable<typeof desktopEvents.toRenderer.closeRequested.signature>): () => void;
    completeClose: NonNullable<typeof desktopEvents.toMain.closeResponse.signature>;
  };
  ai: DesktopInvokeApi["ai"] & {
    onUpdate(listener: NonNullable<typeof desktopEvents.toRenderer.aiUpdate.signature>): () => void;
    onStatus(listener: NonNullable<typeof desktopEvents.toRenderer.aiStatus.signature>): () => void;
  };
  files: DesktopInvokeApi["files"] & { pathForFile(file: File): string };
};

/** Only listed endpoints are exposed; the renderer never receives a raw invoke API. */
export function createDesktopInvokeBridge(invokeRequest: (channel: string, ...args: unknown[]) => Promise<unknown>): DesktopInvokeApi {
  return Object.fromEntries(Object.entries(desktopInvoke).map(([group, methods]) => [group,
    Object.fromEntries(Object.entries(methods).map(([method, endpoint]) => [method,
      (...args: unknown[]) => invokeRequest(endpoint.channel, ...args)
    ]))
  ])) as DesktopInvokeApi;
}
