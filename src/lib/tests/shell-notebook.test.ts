import { describe, expect, it } from "vitest";
import {
  applyShellNotebookEvent,
  buildShellNotebookMarkdown,
  createShellNotebookRuntime,
  openShellNotebook,
} from "@/lib/shellNotebook";

describe("shell notebook IPC boundary", () => {
  it("routes output and completion to the current run only", () => {
    const running = {
      ...createShellNotebookRuntime(["cell-a"]),
      cells: {
        "cell-a": {
          ...createShellNotebookRuntime(["cell-a"]).cells["cell-a"],
          runId: "run-current",
          status: "running" as const,
        },
      },
    };

    const stale = applyShellNotebookEvent(running, {
      type: "output",
      runId: "run-old",
      stream: "stdout",
      chunk: "ignored",
    });
    const output = applyShellNotebookEvent(stale, {
      type: "output",
      runId: "run-current",
      stream: "stderr",
      chunk: "warning",
    });
    const finished = applyShellNotebookEvent(output, {
      type: "runFinished",
      runId: "run-current",
      exitCode: 2,
      durationMs: 18,
      truncated: false,
      currentDirectory: "/tmp/project",
    });

    expect(stale).toBe(running);
    expect(finished.cells["cell-a"]).toMatchObject({
      status: "failed",
      stderr: "warning",
      exitCode: 2,
      durationMs: 18,
    });
    expect(finished.currentDirectory).toBe("/tmp/project");
  });

  it("keeps a session failure distinct from a command failure", () => {
    const running = {
      ...createShellNotebookRuntime(["cell-a"]),
      cells: {
        "cell-a": {
          ...createShellNotebookRuntime(["cell-a"]).cells["cell-a"],
          runId: "run-current",
          status: "running" as const,
        },
      },
    };

    const terminated = applyShellNotebookEvent(running, {
      type: "sessionTerminated",
      runId: "run-current",
      reason: "bash exited",
    });

    expect(terminated.sessionStatus).toBe("lost");
    expect(terminated.cells["cell-a"]?.status).toBe("session-lost");
  });

  it("builds independent shell blocks without execution metadata", () => {
    expect(
      buildShellNotebookMarkdown([
        { id: "empty", source: "  \n" },
        { id: "first", source: "echo first" },
        { id: "second", source: "printf '`\\n```\\n'" },
      ]),
    ).toBe(
      "```shell\necho first\n```\n\n````shell\nprintf '`\\n```\\n'\n````",
    );
  });

  it("rejects browser execution with a structured desktop-only error", async () => {
    await expect(
      openShellNotebook({ startDirectory: "" }, () => undefined),
    ).rejects.toMatchObject({ code: "desktop_only" });
  });
});
