import { describe, expect, it } from "vitest";
import {
  SHELL_NOTEBOOK_DRAFT_VERSION,
  normalizeShellNotebookDraft,
} from "@/pages/tools/shellNotebook";

describe("shell notebook draft schema", () => {
  it("falls back to a single empty cell for missing or damaged drafts", () => {
    const draft = normalizeShellNotebookDraft({
      version: 99,
      cells: "not-an-array",
      startDirectory: 42,
    });

    expect(draft.version).toBe(SHELL_NOTEBOOK_DRAFT_VERSION);
    expect(draft.startDirectory).toBe("");
    expect(draft.cells).toEqual([
      {
        id: expect.any(String),
        source: "",
      },
    ]);
  });

  it("keeps valid cells in order and removes invalid persisted fields", () => {
    const draft = normalizeShellNotebookDraft({
      version: 1,
      startDirectory: "/workspace",
      cells: [
        { id: "first", source: "export APP_ENV=dev", output: "do not persist" },
        { id: "", source: "invalid id" },
        { id: "second", source: 42 },
      ],
      runtime: { stdout: "do not persist" },
    });

    expect(draft).toEqual({
      version: 1,
      startDirectory: "/workspace",
      cells: [{ id: "first", source: "export APP_ENV=dev" }],
    });
  });

  it("retains an empty cell when every stored cell is invalid", () => {
    const draft = normalizeShellNotebookDraft({
      version: 1,
      startDirectory: "  ",
      cells: [{ id: "", source: "" }, null],
    });

    expect(draft.startDirectory).toBe("");
    expect(draft.cells).toHaveLength(1);
    expect(draft.cells[0]?.source).toBe("");
  });
});
