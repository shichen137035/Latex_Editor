import { expect, it, vi } from "vitest";
import { SourceModelContentGuard } from "../../apps/desktop/src/renderer/editor/SourceModelContentGuard.js";

it("reads an unchanged long model only once across repeated scroll/cursor updates", () => {
  const source = "A long article.\n".repeat(30_000);
  const model = { getVersionId: () => 1, getValue: vi.fn(() => source.replaceAll("\n", "\r\n")) };
  const guard = new SourceModelContentGuard();
  for (let event = 0; event < 500; event++) expect(guard.matches(model, source)).toBe(true);
  expect(model.getValue).toHaveBeenCalledTimes(1);
});

it("rechecks changed revisions, external source changes and different models", () => {
  let version = 1, value = "Before";
  const model = { getVersionId: () => version, getValue: vi.fn(() => value) };
  const guard = new SourceModelContentGuard();
  expect(guard.matches(model, "Before")).toBe(true);
  version++; value = "After";
  expect(guard.matches(model, "Before")).toBe(false);
  expect(guard.matches(model, "After")).toBe(true);
  const other = { getVersionId: () => version, getValue: () => "Other" };
  expect(guard.matches(other, "After")).toBe(false);
  expect(model.getValue).toHaveBeenCalledTimes(3);
});
