const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("latexEditor", {
  settings: {
    get: (projectId) => ipcRenderer.invoke("settings:get", projectId),
    set: (key, value, projectId) => ipcRenderer.invoke("settings:set", key, value, projectId),
    detectToolchain: (manual) => ipcRenderer.invoke("toolchain:detect", manual)
  },
  resources: {
    searchCommands: (query) => ipcRenderer.invoke("resources:commands", query)
  },
  spellcheck: {
    status: () => ipcRenderer.invoke("spellcheck:status"),
    configure: (mode, language) => ipcRenderer.invoke("spellcheck:configure", mode, language),
    checkWords: (words, language) => ipcRenderer.invoke("spellcheck:check-words", words, language),
    suggestions: (word, language) => ipcRenderer.invoke("spellcheck:suggestions", word, language),
    addToDictionary: (word) => ipcRenderer.invoke("spellcheck:add-word", word),
    dictionaryWords: () => ipcRenderer.invoke("spellcheck:dictionary-words")
  },
  styleResources: {
    list: () => ipcRenderer.invoke("style-resources:list"),
    create: (name) => ipcRenderer.invoke("style-resources:create", name),
    importFiles: (paths, name) => ipcRenderer.invoke("style-resources:import-files", paths, name),
    importFolder: (folderPath) => ipcRenderer.invoke("style-resources:import-folder", folderPath),
    addFiles: (id, paths) => ipcRenderer.invoke("style-resources:add-files", id, paths),
    duplicate: (id) => ipcRenderer.invoke("style-resources:duplicate", id),
    rename: (id, name) => ipcRenderer.invoke("style-resources:rename", id, name),
    remove: (id) => ipcRenderer.invoke("style-resources:remove", id)
  },
  files: {
    tree: (projectId) => ipcRenderer.invoke("files:tree", projectId),
    read: (projectId, relativePath) => ipcRenderer.invoke("files:read", projectId, relativePath),
    pathForFile: (file) => webUtils.getPathForFile(file),
    readPdf: (projectId, relativePath) => ipcRenderer.invoke("files:read-pdf", projectId, relativePath),
    write: (projectId, relativePath, content) => ipcRenderer.invoke("files:write", projectId, relativePath, content),
    createFile: (projectId, relativePath) => ipcRenderer.invoke("files:create-file", projectId, relativePath),
    createDirectory: (projectId, relativePath) => ipcRenderer.invoke("files:create-directory", projectId, relativePath),
    rename: (projectId, fromRelativePath, toRelativePath) => ipcRenderer.invoke("files:rename", projectId, fromRelativePath, toRelativePath),
    copy: (projectId, fromRelativePath, toRelativePath) => ipcRenderer.invoke("files:copy", projectId, fromRelativePath, toRelativePath),
    import: (projectId, sourcePath, destinationRelativePath) => ipcRenderer.invoke("files:import", projectId, sourcePath, destinationRelativePath),
    remove: (projectId, relativePath) => ipcRenderer.invoke("files:remove", projectId, relativePath)
  },
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    create: (input) => ipcRenderer.invoke("projects:create", input),
    register: (folderPath) => ipcRenderer.invoke("projects:register", folderPath),
    open: (projectId) => ipcRenderer.invoke("projects:open", projectId),
    setMainFile: (projectId, relativePath) => ipcRenderer.invoke("projects:set-main-file", projectId, relativePath)
  },
  compile: {
    run: (projectId, mainFile) => ipcRenderer.invoke("compile:run", projectId, mainFile)
  },
  dialogs: {
    pickFolder: () => ipcRenderer.invoke("dialogs:pick-folder"),
    pickFiles: () => ipcRenderer.invoke("dialogs:pick-files")
  }
});
