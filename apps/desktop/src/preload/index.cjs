const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("latexEditor", {
  settings: {
    get: (projectId) => ipcRenderer.invoke("settings:get", projectId),
    set: (key, value, projectId) => ipcRenderer.invoke("settings:set", key, value, projectId),
    detectToolchain: (manual) => ipcRenderer.invoke("toolchain:detect", manual)
  },
  installation: {
    state: () => ipcRenderer.invoke("installation:state"),
    setMode: (mode, installDirectory) => ipcRenderer.invoke("installation:set-mode", mode, installDirectory),
    recordComponent: (component) => ipcRenderer.invoke("installation:record-component", component),
    recordEnvironment: (toolchain) => ipcRenderer.invoke("installation:record-environment", toolchain),
    removeUserData: (options) => ipcRenderer.invoke("installation:remove-user-data", options)
  },
  resources: {
    searchCommands: (query) => ipcRenderer.invoke("resources:commands", query)
  },
  references: {
    snapshot: (projectId) => ipcRenderer.invoke("references:snapshot", projectId),
    importFile: (path) => ipcRenderer.invoke("references:import-file", path),
    saveEntry: (entry) => ipcRenderer.invoke("references:save-entry", entry),
    removeEntry: (id) => ipcRenderer.invoke("references:remove-entry", id),
    setFavorite: (id, favorite) => ipcRenderer.invoke("references:set-favorite", id, favorite),
    createCollection: (name, parentId) => ipcRenderer.invoke("references:create-collection", name, parentId),
    setProjectLink: (link) => ipcRenderer.invoke("references:set-project-link", link),
    removeProjectLink: (projectId, entryId) => ipcRenderer.invoke("references:remove-project-link", projectId, entryId)
  },
  blockGraph: {
    snapshot: (projectId) => ipcRenderer.invoke("block-graph:snapshot", projectId),
    createBlock: (projectId, input) => ipcRenderer.invoke("block-graph:create-block", projectId, input),
    validateUserBlock: (projectId, input) => ipcRenderer.invoke("block-graph:validate-user-block", projectId, input),
    createUserBlock: (projectId, input) => ipcRenderer.invoke("block-graph:create-user-block", projectId, input),
    deleteUserBlock: (projectId, blockId) => ipcRenderer.invoke("block-graph:delete-user-block", projectId, blockId),
    reconcileParsedBlocks: (projectId, input) => ipcRenderer.invoke("block-graph:reconcile-parsed", projectId, input),
    mapUserBlockRanges: (projectId, input) => ipcRenderer.invoke("block-graph:map-user-ranges", projectId, input),
    addBlock: (projectId, block) => ipcRenderer.invoke("block-graph:add-block", projectId, block),
    updateBlock: (projectId, blockId, patch) => ipcRenderer.invoke("block-graph:update-block", projectId, blockId, patch),
    removeBlock: (projectId, blockId) => ipcRenderer.invoke("block-graph:remove-block", projectId, blockId),
    addDependency: (projectId, prerequisite, consequence) => ipcRenderer.invoke("block-graph:add-dependency", projectId, prerequisite, consequence),
    validateDependency: (projectId, prerequisite, consequence) => ipcRenderer.invoke("block-graph:validate-dependency", projectId, prerequisite, consequence),
    removeDependency: (projectId, prerequisite, consequence) => ipcRenderer.invoke("block-graph:remove-dependency", projectId, prerequisite, consequence),
    hasDirectDependency: (projectId, prerequisite, consequence) => ipcRenderer.invoke("block-graph:has-direct-dependency", projectId, prerequisite, consequence),
    setStructuralParent: (projectId, child, parent) => ipcRenderer.invoke("block-graph:set-structural-parent", projectId, child, parent),
    getDirectPrerequisites: (projectId, blockId) => ipcRenderer.invoke("block-graph:direct-prerequisites", projectId, blockId),
    getDirectConsequences: (projectId, blockId) => ipcRenderer.invoke("block-graph:direct-consequences", projectId, blockId),
    getPrerequisiteClosure: (projectId, blockId, options) => ipcRenderer.invoke("block-graph:prerequisite-closure", projectId, blockId, options),
    getConsequenceClosure: (projectId, blockId, options) => ipcRenderer.invoke("block-graph:consequence-closure", projectId, blockId, options),
    isPrerequisiteOf: (projectId, prerequisite, consequence) => ipcRenderer.invoke("block-graph:is-prerequisite-of", projectId, prerequisite, consequence),
    getStructuralParent: (projectId, blockId) => ipcRenderer.invoke("block-graph:structural-parent", projectId, blockId),
    getStructuralChildren: (projectId, blockId) => ipcRenderer.invoke("block-graph:structural-children", projectId, blockId),
    getStructuralAncestors: (projectId, blockId) => ipcRenderer.invoke("block-graph:structural-ancestors", projectId, blockId),
    getStructuralDescendants: (projectId, blockId) => ipcRenderer.invoke("block-graph:structural-descendants", projectId, blockId),
    isStructuralAncestor: (projectId, ancestor, descendant) => ipcRenderer.invoke("block-graph:is-structural-ancestor", projectId, ancestor, descendant),
    getStronglyConnectedComponents: (projectId) => ipcRenderer.invoke("block-graph:scc", projectId),
    detectDependencyCycles: (projectId) => ipcRenderer.invoke("block-graph:cycles", projectId),
    findStructuralOverlapsInPrerequisites: (projectId, blockId) => ipcRenderer.invoke("block-graph:prerequisite-overlaps", projectId, blockId),
    findStructuralOverlapsInConsequences: (projectId, blockId) => ipcRenderer.invoke("block-graph:consequence-overlaps", projectId, blockId),
    findLogicalRelationsWithinPrerequisites: (projectId, blockId) => ipcRenderer.invoke("block-graph:prerequisite-relations", projectId, blockId),
    getBlocksBetween: (projectId, start, end) => ipcRenderer.invoke("block-graph:between", projectId, start, end),
    getRelationNeighborhood: (projectId, focusId, direction, depth) => ipcRenderer.invoke("block-graph:neighborhood", projectId, focusId, direction, depth),
    historyState: (projectId) => ipcRenderer.invoke("block-graph:history-state", projectId),
    undo: (projectId) => ipcRenderer.invoke("block-graph:undo", projectId),
    redo: (projectId) => ipcRenderer.invoke("block-graph:redo", projectId),
    validate: (projectId) => ipcRenderer.invoke("block-graph:validate", projectId)
  },
  spellcheck: {
    checkText: (text, language) => ipcRenderer.invoke("spellcheck:check-text", text, language),
    status: () => ipcRenderer.invoke("spellcheck:status"),
    configure: (mode, language) => ipcRenderer.invoke("spellcheck:configure", mode, language),
    checkWords: (words, language) => ipcRenderer.invoke("spellcheck:check-words", words, language),
    suggestions: (word, language) => ipcRenderer.invoke("spellcheck:suggestions", word, language),
    addToDictionary: (word) => ipcRenderer.invoke("spellcheck:add-word", word),
    dictionaryWords: () => ipcRenderer.invoke("spellcheck:dictionary-words"),
    listDictionaries: (query) => ipcRenderer.invoke("spellcheck:list-dictionaries", query),
    refreshDictionaries: () => ipcRenderer.invoke("spellcheck:refresh-dictionaries"),
    installDictionary: (id) => ipcRenderer.invoke("spellcheck:install-dictionary", id),
    removeDictionary: (id) => ipcRenderer.invoke("spellcheck:remove-dictionary", id)
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
  themes: {
    list: () => ipcRenderer.invoke("themes:list"),
    directory: () => ipcRenderer.invoke("themes:directory"),
    importFiles: (paths) => ipcRenderer.invoke("themes:import-files", paths),
    importFolder: (folderPath) => ipcRenderer.invoke("themes:import-folder", folderPath),
    remove: (id) => ipcRenderer.invoke("themes:remove", id)
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
  images: {
    pick: (multiple) => ipcRenderer.invoke("images:pick", multiple),
    import: (projectId, sourcePaths, directory) => ipcRenderer.invoke("images:import", projectId, sourcePaths, directory),
    resolve: (projectId, texPath, requestedPath, graphicPaths) => ipcRenderer.invoke("images:resolve", projectId, texPath, requestedPath, graphicPaths)
  },
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    create: (input) => ipcRenderer.invoke("projects:create", input),
    register: (folderPath) => ipcRenderer.invoke("projects:register", folderPath),
    open: (projectId) => ipcRenderer.invoke("projects:open", projectId),
    setMainFile: (projectId, relativePath) => ipcRenderer.invoke("projects:set-main-file", projectId, relativePath),
    relocateInDirectory: (projectId, folderPath) => ipcRenderer.invoke("projects:directory-relocate", projectId, folderPath),
    updateDirectoryEntry: (projectId, patch) => ipcRenderer.invoke("projects:directory-update", projectId, patch),
    removeFromDirectory: (projectId) => ipcRenderer.invoke("projects:directory-remove", projectId),
    deleteToRecycleBin: (projectId, confirmedPath) => ipcRenderer.invoke("projects:directory-delete", projectId, confirmedPath),
    revealInFileManager: (projectId) => ipcRenderer.invoke("projects:directory-reveal", projectId),
    copyProjectPath: (projectId) => ipcRenderer.invoke("projects:directory-copy-path", projectId)
  },
  compile: {
    run: (projectId, mainFile) => ipcRenderer.invoke("compile:run", projectId, mainFile)
  },
  synctex: {
    forward: (projectId, sourceFile, pdfFile, line, column) => ipcRenderer.invoke("synctex:forward", projectId, sourceFile, pdfFile, line, column),
    reverse: (projectId, pdfFile, page, x, y) => ipcRenderer.invoke("synctex:reverse", projectId, pdfFile, page, x, y)
  },
  dialogs: {
    pickFolder: () => ipcRenderer.invoke("dialogs:pick-folder"),
    pickFiles: () => ipcRenderer.invoke("dialogs:pick-files"),
    pickThemeFiles: () => ipcRenderer.invoke("dialogs:pick-theme-files")
  }
});
