import { ipcMain } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import type { EventEndpoint, InvokeEndpoint } from "@latex-editor/contracts/desktop-ipc";

let maintenanceMessage: string | undefined;
let activeRequests = 0;

/** Stop new IPC work and refuse cleanup while any earlier request is still using project data. */
export async function withIpcMaintenance<T>(message: string, operation: () => Promise<T>): Promise<T> {
  if (maintenanceMessage || activeRequests > 1) throw new Error(maintenanceMessage ?? message);
  maintenanceMessage = message;
  try { return await operation(); }
  finally { maintenanceMessage = undefined; }
}

/** Electron remains the adapter; descriptor types check both inputs and outputs. */
export function handleIpc<F extends (...args: never[]) => Promise<unknown>>(
  endpoint: InvokeEndpoint<F>,
  handler: (event: IpcMainInvokeEvent, ...args: Parameters<NoInfer<F>>) => Awaited<ReturnType<F>> | Promise<Awaited<ReturnType<F>>>
): void {
  ipcMain.handle(endpoint.channel, async (event, ...args: Parameters<F>) => {
    if (maintenanceMessage) throw new Error(maintenanceMessage);
    activeRequests++;
    try { return await handler(event, ...args); }
    finally { activeRequests--; }
  });
}

export function onIpc<Args extends unknown[]>(endpoint: EventEndpoint<Args>, handler: NoInfer<(event: IpcMainEvent, ...args: Args) => void>): void {
  ipcMain.on(endpoint.channel, handler);
}

export function sendIpc<Args extends unknown[]>(target: WebContents, endpoint: EventEndpoint<Args>, ...args: NoInfer<Args>): void {
  target.send(endpoint.channel, ...args);
}
