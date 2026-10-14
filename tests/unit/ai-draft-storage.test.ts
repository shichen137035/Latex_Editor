import { describe, expect, it } from "vitest";
import { readAIDraft, writeAIDraft } from "../../apps/desktop/src/renderer/ai/draftStorage.js";

function createStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, String(value)); },
    removeItem: (key: string) => { entries.delete(key); }
  };
}

describe("AI composer draft storage", () => {
  it("restores drafts across AI panel remounts and keeps projects separate", () => {
    const storage = createStorage();
    writeAIDraft("project/one", "Unsaved question", storage);

    expect(readAIDraft("project/one", storage)).toBe("Unsaved question");
    expect(readAIDraft("project/two", storage)).toBe("");
  });

  it("removes a project's draft after a successful send", () => {
    const storage = createStorage();
    writeAIDraft("project/one", "Sent question", storage);
    writeAIDraft("project/one", "", storage);

    expect(readAIDraft("project/one", storage)).toBe("");
  });
});
