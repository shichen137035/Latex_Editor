import { app, type BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const directory = process.env.TEXWEAVE_PACKAGE_SMOKE_DIR;
export const packageSmokeEnabled = Boolean(directory && isAbsolute(directory));
let finished = false;

/** Opt-in packaged startup check; never uses the user's normal profile. */
export function finishPackageSmoke(error?: unknown): void {
  if (!packageSmokeEnabled || finished) return;
  finished = true;
  const message = error instanceof Error ? error.stack ?? error.message : error === undefined ? undefined : String(error);
  writeFileSync(join(directory!, "startup.json"), JSON.stringify({ ok: error === undefined, packaged: app.isPackaged, version: app.getVersion(), ...(message ? { error: message } : {}) }, null, 2));
  app.exit(error === undefined ? 0 : 1);
}

if (packageSmokeEnabled) {
  mkdirSync(join(directory!, "profile"), { recursive: true });
  app.setPath("userData", join(directory!, "profile"));
  app.setPath("sessionData", join(directory!, "profile"));
  process.on("uncaughtException", finishPackageSmoke);
  process.on("unhandledRejection", finishPackageSmoke);
  setTimeout(() => finishPackageSmoke(new Error("Packaged startup timed out after 45 seconds")), 45_000).unref();
}

export function checkPackageWindow(window: BrowserWindow): void {
  if (!packageSmokeEnabled) return;
  window.webContents.on("preload-error", (_event, _path, error) => finishPackageSmoke(error));
  window.webContents.on("render-process-gone", (_event, details) => finishPackageSmoke(new Error(`Renderer exited: ${details.reason}`)));
  window.webContents.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
    if (mainFrame) finishPackageSmoke(new Error(`Renderer failed to load (${code}): ${description}`));
  });
  window.webContents.once("did-finish-load", () => {
    void window.webContents.executeJavaScript(`(async () => {
      if (!window.latexEditor) throw new Error('Preload bridge is unavailable');
      const info = await window.latexEditor.app.info();
      if (!info.version) throw new Error('Application IPC is unavailable');
      const deadline = Date.now() + 20000;
      while (!document.querySelector('.directory-main') || !document.querySelector('[data-app-version]')?.textContent.includes(info.version)) {
        if (Date.now() >= deadline) throw new Error('React did not mount the home page');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      await window.latexEditor.projects.list();
      const styles = await window.latexEditor.styleResources.list();
      for (const id of ['default', 'light', 'empty']) {
        const resource = styles.find(item => item.id === id && item.source === 'built-in');
        if (!resource) throw new Error('Built-in style is not listed: ' + id);
        for (const file of resource.files) {
          const content = await window.latexEditor.styleResources.readFile(id, file.targetPath);
          if (!content?.content) throw new Error('Built-in style cannot be read: ' + id);
        }
      }
      const setup = await window.latexEditor.installation.setupStatus();
      if (!setup.required) throw new Error('Fresh packaged profile did not request initial setup');
      while (!document.querySelector('.first-run-setup')) {
        if (Date.now() >= deadline) throw new Error('Initial setup did not mount');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return true;
    })()`).then(() => finishPackageSmoke(), finishPackageSmoke);
  });
}
