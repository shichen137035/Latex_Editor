const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("latexEditor", {
  settings: {
    get: (projectId) => ipcRenderer.invoke("settings:get", projectId),
    set: (key, value, projectId) => ipcRenderer.invoke("settings:set", key, value, projectId),
    detectToolchain: (manual) => ipcRenderer.invoke("toolchain:detect", manual)
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
    pickFolder: () => ipcRenderer.invoke("dialogs:pick-folder")
  }
});
