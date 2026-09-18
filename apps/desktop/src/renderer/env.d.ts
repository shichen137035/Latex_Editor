import type { CommandMetadata, CompileResult, FileWriteResult, Project, ProjectTreeNode, TextFileContent, SettingsSnapshot, PreferenceKey, LatexToolchain, StyleResource, SpellCheckMode, SpellCheckStatus } from "@latex-editor/contracts";

declare global {
  interface Window {
    latexEditor?: {
      settings: {
        get(projectId?: string): Promise<SettingsSnapshot>;
        set(key: PreferenceKey, value: unknown, projectId?: string): Promise<SettingsSnapshot>;
        detectToolchain(manual?: "directory" | "executable"): Promise<LatexToolchain | undefined>;
      };
      resources: {
        searchCommands(query: string): Promise<CommandMetadata[]>;
      };
      spellcheck: {
        status(): Promise<SpellCheckStatus | undefined>;
        configure(mode: SpellCheckMode, language: string): Promise<SpellCheckStatus | undefined>;
        checkWords(words: string[], language: string): Promise<string[]>;
        suggestions(word: string, language: string): Promise<string[]>;
        addToDictionary(word: string): Promise<boolean>;
        dictionaryWords(): Promise<string[]>;
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
      projects: {
        list(): Promise<Project[]>;
        create(input: { name: string; parentPath: string; styleResourceIds?: string[] }): Promise<Project>;
        register(folderPath: string): Promise<Project>;
        open(projectId: string): Promise<Project>;
        setMainFile(projectId: string, relativePath: string): Promise<Project>;
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
      compile: {
        run(projectId: string, mainFile?: string): Promise<CompileResult & { pdfDataUrl?: string }>;
      };
      dialogs: {
        pickFolder(): Promise<string | undefined>;
        pickFiles(): Promise<string[]>;
      };
    };
  }
}

export {};
