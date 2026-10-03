import type { BrowserWindow } from "electron";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Only the local development server may replace the packaged file renderer. */
export function resolveRendererTarget(rendererPath: string, requestedUrl: string | undefined, isPackaged: boolean): string {
  if (!isPackaged && requestedUrl) {
    const candidate = parseUrl(requestedUrl);
    if (!candidate || !isLoopbackRenderer(candidate)) {
      throw new Error("TEXWEAVE_RENDERER_URL must point to an HTTP(S) loopback renderer.");
    }
    return candidate.href;
  }
  return pathToFileURL(resolve(rendererPath)).href;
}

export function isTrustedRendererNavigation(candidateUrl: string, rendererTarget: string): boolean {
  const candidate = parseUrl(candidateUrl);
  const target = parseUrl(rendererTarget);
  if (!candidate || !target || candidate.protocol !== target.protocol) return false;

  if (target.protocol === "file:") {
    try {
      return resolve(fileURLToPath(candidate)) === resolve(fileURLToPath(target));
    } catch {
      return false;
    }
  }

  return !candidate.username && !candidate.password
    && candidate.origin === target.origin
    && candidate.pathname === target.pathname;
}

/** Renderer-created windows are denied; safe web links go through the OS browser. */
export function safeExternalHttpUrl(value: string): string | undefined {
  const url = parseUrl(value);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password) return undefined;
  return url.href;
}

export function installRendererSecurity(
  window: BrowserWindow,
  rendererTarget: string,
  openExternal: (url: string) => Promise<unknown>
): void {
  const { webContents } = window;
  webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = safeExternalHttpUrl(url);
    if (externalUrl) void openExternal(externalUrl).catch(() => undefined);
    return { action: "deny" };
  });

  const denyUntrustedNavigation = (event: Electron.Event, url: string) => {
    if (!isTrustedRendererNavigation(url, rendererTarget)) event.preventDefault();
  };
  webContents.on("will-navigate", denyUntrustedNavigation);
  webContents.on("will-redirect", denyUntrustedNavigation);
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isLoopbackRenderer(url: URL): boolean {
  return (url.protocol === "http:" || url.protocol === "https:")
    && LOOPBACK_HOSTS.has(url.hostname)
    && !url.username
    && !url.password;
}
