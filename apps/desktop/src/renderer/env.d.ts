import type { CompileResult, FileWriteResult, Project, ProjectTreeNode, TextFileContent, SettingsSnapshot, PreferenceKey, LatexToolchain } from "@latex-editor/contracts";

declare global {
  interface Window {
    latexEditor?: {
      settings: {
        get(projectId?: string): Promise<SettingsSnapshot>;
        set(key: PreferenceKey, value: unknown, projectId?: string): Promise<SettingsSnapshot>;
        detectToolchain(manual?: "directory" | "executable"): Promise<LatexToolchain | undefined>;
      };
      projects: {
        list(): Promise<Project[]>;
        create(input: { name: string; parentPath: string }): Promise<Project>;
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
      };
    };
  }
}

export {};
