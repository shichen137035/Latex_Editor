import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { installRendererSecurity, isTrustedRendererNavigation, resolveRendererTarget, safeExternalHttpUrl } from "../../apps/desktop/src/main/renderer-security.js";

describe("Electron renderer security policy", () => {
  it("uses only a loopback URL for the development renderer", () => {
    expect(resolveRendererTarget("renderer/index.html", "http://127.0.0.1:5173/", false)).toBe("http://127.0.0.1:5173/");
    expect(() => resolveRendererTarget("renderer/index.html", "https://example.com/", false)).toThrow(/loopback/);
    expect(() => resolveRendererTarget("renderer/index.html", "http://user@localhost:5173/", false)).toThrow(/loopback/);
    expect(resolveRendererTarget("renderer/index.html", "https://example.com/", true)).toMatch(/^file:/);
  });

  it("allows only the renderer's own document URL for navigation and redirects", () => {
    const dev = "http://127.0.0.1:5173/";
    expect(isTrustedRendererNavigation("http://127.0.0.1:5173/#/project", dev)).toBe(true);
    expect(isTrustedRendererNavigation("http://127.0.0.1:5174/", dev)).toBe(false);
    expect(isTrustedRendererNavigation("http://127.0.0.1:5173/untrusted", dev)).toBe(false);
    expect(isTrustedRendererNavigation("https://example.com/", dev)).toBe(false);

    const packaged = resolveRendererTarget("renderer/index.html", undefined, true);
    expect(isTrustedRendererNavigation(`${packaged}#project`, packaged)).toBe(true);
    expect(isTrustedRendererNavigation(packaged.replace("index.html", "other.html"), packaged)).toBe(false);
  });

  it("opens only HTTP(S) links externally", () => {
    expect(safeExternalHttpUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(safeExternalHttpUrl("http://example.com")).toBe("http://example.com/");
    expect(safeExternalHttpUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeExternalHttpUrl("file:///C:/secret.txt")).toBeUndefined();
    expect(safeExternalHttpUrl("data:text/html,hello")).toBeUndefined();
    expect(safeExternalHttpUrl("https://user@example.com/")).toBeUndefined();
  });

  it("returns false for malformed candidates and blocks unsafe window/navigation requests", () => {
    expect(isTrustedRendererNavigation("not a url", "file:///renderer/index.html")).toBe(false);
    expect(safeExternalHttpUrl("")).toBeUndefined();

    const setWindowOpenHandler = vi.fn();
    const navigationHandlers = new Map<string, (event: { preventDefault(): void }, url: string) => void>();
    const webContents = {
      setWindowOpenHandler,
      on: vi.fn((event: string, handler: (event: { preventDefault(): void }, url: string) => void) => navigationHandlers.set(event, handler))
    };
    const openExternal = vi.fn(async () => undefined);
    installRendererSecurity({ webContents } as unknown as BrowserWindow, "http://127.0.0.1:5173/", openExternal);

    const openHandler = setWindowOpenHandler.mock.calls[0]?.[0] as (details: { url: string }) => { action: string };
    expect(openHandler({ url: "https://example.com/" })).toEqual({ action: "deny" });
    expect(openHandler({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledTimes(1);

    const preventDefault = vi.fn();
    navigationHandlers.get("will-navigate")?.({ preventDefault }, "https://example.com/");
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
