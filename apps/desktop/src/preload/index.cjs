// @ts-check
const { contextBridge, ipcRenderer, webUtils } = require("electron");
const { createDesktopInvokeBridge, desktopEvents } = require("@latex-editor/contracts/desktop-ipc");

const requests = createDesktopInvokeBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args));
/**
 * @template Payload
 * @param {import("@latex-editor/contracts/desktop-ipc").EventEndpoint<[Payload]>} endpoint
 * @param {(payload: Payload) => void} listener
 */
const subscribe = (endpoint, listener) => {
  /** @type {(event: Electron.IpcRendererEvent, payload: Payload) => void} */
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(endpoint.channel, handler);
  return () => ipcRenderer.removeListener(endpoint.channel, handler);
};

/** @type {import("@latex-editor/contracts/desktop-ipc").DesktopApi} */
const api = {
  ...requests,
  relations: { ...requests.relations, onUpdate: (listener) => subscribe(desktopEvents.toRenderer.relationUpdate, listener) },
  compile: { ...requests.compile, onUpdate: (listener) => subscribe(desktopEvents.toRenderer.compileUpdate, listener) },
  projects: { ...requests.projects, onUpdate: (listener) => subscribe(desktopEvents.toRenderer.projectUpdate, listener) },
  lifecycle: {
    ...requests.lifecycle,
    onCloseRequested: (listener) => {
      const unsubscribe = subscribe(desktopEvents.toRenderer.closeRequested, listener);
      ipcRenderer.send(desktopEvents.toMain.closeReady.channel);
      return unsubscribe;
    },
    completeClose: (requestId, allow) => ipcRenderer.send(desktopEvents.toMain.closeResponse.channel, requestId, allow)
  },
  ai: {
    ...requests.ai,
    onUpdate: (listener) => subscribe(desktopEvents.toRenderer.aiUpdate, listener),
    onStatus: (listener) => subscribe(desktopEvents.toRenderer.aiStatus, listener)
  },
  files: {
    ...requests.files,
    pathForFile: (file) => webUtils.getPathForFile(file)
  }
};

contextBridge.exposeInMainWorld("latexEditor", api);
