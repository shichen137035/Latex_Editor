import type { AIStatus, AIModelOption, AIConversation, AIChangeSet, AIContextSnapshotFile, AIProjectSkill, AIMode, AIMessage, BlockCreationValidation, BlockGraphSnapshot, BlockId, BlockRangeMappingResult, BlockReconciliationResult, CommandMetadata, CompileResult, CreateSemanticBlockInput, CreateUserBlockInput, DependencyCycle, DictionaryPackage, FileWriteResult, GraphDiagnostic, GraphTraversalOptions, GraphTraversalResult, ImportedImage, LogicalRelation, MapUserBlockRangesInput, Project, ProjectTreeNode, ReconcileParsedBlocksInput, RelationDirection, RelationMutationResult, RelationNeighborhood, RelationValidation, ResolvedGraphic, SemanticBlock, SettingsSnapshot, PreferenceKey, LatexToolchain, StyleResource, ThemeDefinition, SpellCheckMode, SpellCheckStatus, StructuralDependencyOverlap, StructuralHistoryState, SyncTexPdfPosition, SyncTexSourcePosition, TextFileContent, UpdateSemanticBlockInput, ProjectReferenceLink, ReferenceLibraryEntry, ReferenceLibrarySnapshot, ReferenceImportResult } from "@latex-editor/contracts";

type InstallationState = {
  schemaVersion: 1;
  product: "TeXWeave";
  appVersion: string;
  installMode: "recommended" | "custom";
  installDirectory?: string;
  installerLanguage?: string;
  requestedComponents: string[];
  components: Array<{ id: string; version: string; ownership: "external" | "installed-by-texweave" | "user-managed"; installedAt: string; path?: string; source?: string }>;
  lastEnvironmentCheck?: string;
  environment?: LatexToolchain;
};

declare global {
  const __APP_VERSION__: string;
  interface Window {
    latexEditor?: {
      settings: {
        get(projectId?: string): Promise<SettingsSnapshot>;
        set(key: PreferenceKey, value: unknown, projectId?: string): Promise<SettingsSnapshot>;
        detectToolchain(manual?: "directory" | "executable"): Promise<LatexToolchain | undefined>;
      };
      installation: {
        state(): Promise<InstallationState | undefined>;
        setMode(mode: "recommended" | "custom", installDirectory?: string): Promise<InstallationState | undefined>;
        recordComponent(component: { id: string; version: string; ownership: "external" | "installed-by-texweave" | "user-managed"; path?: string; source?: string }): Promise<InstallationState | undefined>;
        recordEnvironment(toolchain: LatexToolchain): Promise<InstallationState | undefined>;
        removeUserData(options: { settings: boolean; themes: boolean; languages: boolean; spellcheck: boolean; templates: boolean; cache: boolean }): Promise<void>;
      };
      resources: {
        searchCommands(query: string): Promise<CommandMetadata[]>;
      };
      references: {
        snapshot(projectId?: string): Promise<ReferenceLibrarySnapshot | undefined>;
        importFile(path: string): Promise<ReferenceImportResult>;
        saveEntry(entry: Partial<ReferenceLibraryEntry> & Pick<ReferenceLibraryEntry, "citationKey" | "entryType" | "fields">): Promise<ReferenceLibraryEntry>;
        removeEntry(id: string): Promise<void>;
        setFavorite(id: string, favorite: boolean): Promise<void>;
        createCollection(name: string, parentId?: string): Promise<{ id: string; name: string; parentId?: string }>;
        setProjectLink(link: ProjectReferenceLink): Promise<void>;
        removeProjectLink(projectId: string, entryId: string): Promise<void>;
      };
      blockGraph: {
        snapshot(projectId: string): Promise<BlockGraphSnapshot>;
        createBlock(projectId: string, input: CreateSemanticBlockInput): Promise<SemanticBlock>;
        validateUserBlock(projectId: string, input: CreateUserBlockInput): Promise<BlockCreationValidation>;
        createUserBlock(projectId: string, input: CreateUserBlockInput): Promise<SemanticBlock>;
        deleteUserBlock(projectId: string, blockId: BlockId): Promise<void>;
        reconcileParsedBlocks(projectId: string, input: ReconcileParsedBlocksInput): Promise<BlockReconciliationResult>;
        mapUserBlockRanges(projectId: string, input: MapUserBlockRangesInput): Promise<BlockRangeMappingResult>;
        addBlock(projectId: string, block: SemanticBlock): Promise<void>;
        updateBlock(projectId: string, blockId: BlockId, patch: UpdateSemanticBlockInput): Promise<SemanticBlock>;
        removeBlock(projectId: string, blockId: BlockId): Promise<void>;
        addDependency(projectId: string, prerequisite: BlockId, consequence: BlockId): Promise<RelationMutationResult>;
        validateDependency(projectId: string, prerequisite: BlockId, consequence: BlockId): Promise<RelationValidation>;
        removeDependency(projectId: string, prerequisite: BlockId, consequence: BlockId): Promise<void>;
        hasDirectDependency(projectId: string, prerequisite: BlockId, consequence: BlockId): Promise<boolean>;
        setStructuralParent(projectId: string, child: BlockId, parent: BlockId | null): Promise<void>;
        getDirectPrerequisites(projectId: string, blockId: BlockId): Promise<BlockId[]>;
        getDirectConsequences(projectId: string, blockId: BlockId): Promise<BlockId[]>;
        getPrerequisiteClosure(projectId: string, blockId: BlockId, options?: GraphTraversalOptions): Promise<GraphTraversalResult>;
        getConsequenceClosure(projectId: string, blockId: BlockId, options?: GraphTraversalOptions): Promise<GraphTraversalResult>;
        isPrerequisiteOf(projectId: string, prerequisite: BlockId, consequence: BlockId): Promise<boolean>;
        getStructuralParent(projectId: string, blockId: BlockId): Promise<BlockId | null>;
        getStructuralChildren(projectId: string, blockId: BlockId): Promise<BlockId[]>;
        getStructuralAncestors(projectId: string, blockId: BlockId): Promise<BlockId[]>;
        getStructuralDescendants(projectId: string, blockId: BlockId): Promise<BlockId[]>;
        isStructuralAncestor(projectId: string, ancestor: BlockId, descendant: BlockId): Promise<boolean>;
        getStronglyConnectedComponents(projectId: string): Promise<BlockId[][]>;
        detectDependencyCycles(projectId: string): Promise<DependencyCycle[]>;
        findStructuralOverlapsInPrerequisites(projectId: string, blockId: BlockId): Promise<StructuralDependencyOverlap[]>;
        findStructuralOverlapsInConsequences(projectId: string, blockId: BlockId): Promise<StructuralDependencyOverlap[]>;
        findLogicalRelationsWithinPrerequisites(projectId: string, blockId: BlockId): Promise<LogicalRelation[]>;
        getBlocksBetween(projectId: string, start: BlockId, end: BlockId): Promise<BlockId[]>;
        getRelationNeighborhood(projectId: string, focusId: BlockId | null, direction: RelationDirection, depth: number | "all"): Promise<RelationNeighborhood>;
        historyState(projectId: string): Promise<StructuralHistoryState>;
        undo(projectId: string): Promise<BlockGraphSnapshot>;
        redo(projectId: string): Promise<BlockGraphSnapshot>;
        validate(projectId: string): Promise<GraphDiagnostic[]>;
      };
      spellcheck: {
        checkText(text: string, language: string): Promise<Array<{ word: string; start: number; end: number; suggestions: string[] }>>;
        status(): Promise<SpellCheckStatus | undefined>;
        configure(mode: SpellCheckMode, language: string): Promise<SpellCheckStatus | undefined>;
        checkWords(words: string[], language: string): Promise<string[]>;
        suggestions(word: string, language: string): Promise<string[]>;
        addToDictionary(word: string): Promise<boolean>;
        dictionaryWords(): Promise<string[]>;
        listDictionaries(query?: string): Promise<DictionaryPackage[]>;
        refreshDictionaries(): Promise<DictionaryPackage[]>;
        installDictionary(id: string): Promise<DictionaryPackage>;
        removeDictionary(id: string): Promise<SpellCheckStatus | undefined>;
      };
      styleResources: {
        list(): Promise<StyleResource[]>;
        create(name: string): Promise<StyleResource>;
        importFiles(paths: string[], name?: string): Promise<StyleResource>;
        importFolder(folderPath: string): Promise<StyleResource>;
        addFiles(id: string, paths: string[]): Promise<StyleResource>;
        duplicate(id: string): Promise<StyleResource>;
        rename(id: string, name: string): Promise<StyleResource>;
        remove(id: string): Promise<void>;
      };
      themes: {
        list(): Promise<ThemeDefinition[]>;
        directory(): Promise<string>;
        importFiles(paths: string[]): Promise<ThemeDefinition[]>;
        importFolder(folderPath: string): Promise<ThemeDefinition[]>;
        remove(id: string): Promise<void>;
      };
      projects: {
        list(): Promise<Project[]>;
        create(input: { name: string; parentPath: string; styleResourceIds?: string[] }): Promise<Project>;
        register(folderPath: string): Promise<Project>;
        open(projectId: string): Promise<Project>;
        setMainFile(projectId: string, relativePath: string): Promise<Project>;
        relocateInDirectory(projectId: string, folderPath: string): Promise<Project>;
        updateDirectoryEntry(projectId: string, patch: { displayName?: string; isFavorite?: boolean; isPinned?: boolean }): Promise<Project>;
        removeFromDirectory(projectId: string): Promise<unknown>;
        deleteToRecycleBin(projectId: string, confirmedPath: string): Promise<boolean>;
        revealInFileManager(projectId: string): Promise<void>;
        copyProjectPath(projectId: string): Promise<void>;
      };
      files: {
        tree(projectId: string): Promise<ProjectTreeNode[]>;
        read(projectId: string, relativePath: string): Promise<TextFileContent>;
        pathForFile(file: File): string;
        readPdf(projectId: string, relativePath: string): Promise<string | undefined>;
        write(projectId: string, relativePath: string, content: string): Promise<FileWriteResult>;
        createFile(projectId: string, relativePath: string): Promise<void>;
        createDirectory(projectId: string, relativePath: string): Promise<void>;
        rename(projectId: string, fromRelativePath: string, toRelativePath: string): Promise<void>;
        copy(projectId: string, fromRelativePath: string, toRelativePath: string): Promise<void>;
        import(projectId: string, sourcePath: string, destinationRelativePath: string): Promise<void>;
        remove(projectId: string, relativePath: string): Promise<void>;
      };
      images: {
        pick(multiple?: boolean): Promise<string[]>;
        import(projectId: string, sourcePaths: string[], directory: string): Promise<ImportedImage[]>;
        resolve(projectId: string, texPath: string, requestedPath: string, graphicPaths?: string[]): Promise<ResolvedGraphic>;
      };
      compile: {
        run(projectId: string, mainFile?: string): Promise<CompileResult & { pdfDataUrl?: string }>;
      };
      ai: {
        detect(): Promise<AIStatus | undefined>;
        models(): Promise<AIModelOption[] | undefined>;
        install(): Promise<AIStatus | undefined>;
        status(): Promise<AIStatus | undefined>;
        login(): Promise<AIStatus | undefined>;
        logout(): Promise<AIStatus | undefined>;
        setExecutable(path: string): Promise<AIStatus | undefined>;
        copilotStatus(): Promise<AIStatus | undefined>;
        installCopilot(): Promise<AIStatus | undefined>;
        loginCopilot(): Promise<AIStatus | undefined>;
        logoutCopilot(): Promise<AIStatus | undefined>;
        copilotModels(): Promise<AIModelOption[] | undefined>;
        skills(): Promise<AIProjectSkill[] | undefined>;
        saveSkill(input: { name: string; content: string; create?: boolean }): Promise<AIProjectSkill[] | undefined>;
        conversations(projectId?: string): Promise<{ conversations: AIConversation[]; changeSets: AIChangeSet[] } | undefined>;
        createConversation(mode: AIMode, projectId?: string): Promise<AIConversation | undefined>;
        setConversationMode(id: string, mode: AIMode): Promise<AIConversation | undefined>;
        removeConversation(id: string): Promise<void>;
        resolveChangeSet(id: string, decisions: Record<string, "accepted" | "rejected">, applied: boolean): Promise<AIChangeSet | undefined>;
        send(input: { conversationId: string; projectId?: string; content: string; contextText?: string; overrides?: AIContextSnapshotFile[] }): Promise<{ conversation: AIConversation; taskId: string } | undefined>;
        cancel(taskId: string): Promise<void>;
        onUpdate(listener: (update: { kind: "conversation" | "changes"; payload: AIConversation | AIChangeSet }) => void): () => void;
        onStatus(listener: (status: AIStatus) => void): () => void;
      };
      synctex: {
        forward(projectId: string, sourceFile: string, pdfFile: string, line: number, column: number): Promise<SyncTexPdfPosition>;
        reverse(projectId: string, pdfFile: string, page: number, x: number, y: number): Promise<SyncTexSourcePosition>;
      };
      dialogs: {
        pickFolder(): Promise<string | undefined>;
        pickFiles(): Promise<string[]>;
        pickThemeFiles(): Promise<string[]>;
      };
    };
  }
}

export {};
