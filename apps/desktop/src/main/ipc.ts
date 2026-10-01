import { ipcMain } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import type { EventEndpoint, InvokeEndpoint } from "@latex-editor/contracts/desktop-ipc";

/** Electron remains the adapter; descriptor types check both inputs and outputs. */
export function handleIpc<F extends (...args: never[]) => Promise<unknown>>(
  endpoint: InvokeEndpoint<F>,
  handler: (event: IpcMainInvokeEvent, ...args: Parameters<NoInfer<F>>) => Awaited<ReturnType<F>> | Promise<Awaited<ReturnType<F>>>
): void {
  ipcMain.handle(endpoint.channel, handler);
}

export function onIpc<Args extends unknown[]>(endpoint: EventEndpoint<Args>, handler: NoInfer<(event: IpcMainEvent, ...args: Args) => void>): void {
  ipcMain.on(endpoint.channel, handler);
}

export function sendIpc<Args extends unknown[]>(target: WebContents, endpoint: EventEndpoint<Args>, ...args: NoInfer<Args>): void {
  target.send(endpoint.channel, ...args);
}
