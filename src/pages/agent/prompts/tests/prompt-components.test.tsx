import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/config";
import { usePromptRecentStore, usePromptStore } from "@/store";
import type { PromptTemplate } from "@/types";
import { PromptManagerDialog } from "@/pages/agent/prompts/PromptManagerDialog";
import { PromptPicker } from "@/pages/agent/prompts/PromptPicker";

type PromptStoreState = ReturnType<typeof usePromptStore.getState>;

const initialPromptStoreState = usePromptStore.getInitialState();
const initialPromptRecentState = usePromptRecentStore.getInitialState();

function prompt(
  id: string,
  name: string,
  overrides: Partial<PromptTemplate> = {}
): PromptTemplate {
  return {
    id,
    name,
    description: "",
    content: `${name} body`,
    tags: [],
    favorite: false,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

function setPromptStore(
  items: PromptTemplate[],
  overrides: Partial<ReturnType<typeof usePromptStore.getState>> = {}
) {
  usePromptStore.setState({
    items,
    loaded: true,
    loading: false,
    error: null,
    load: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    edit: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

function statefulAdd(id: string) {
  return vi.fn(
    async (input: Parameters<PromptStoreState["add"]>[0]): Promise<void> => {
      const created = prompt(id, input.name, {
        ...input,
        createdAt: "2026-08-18T01:00:00.000Z",
        updatedAt: "2026-08-18T01:00:00.000Z",
      });
      usePromptStore.setState((state) => ({
        items: [created, ...state.items],
      }));
    }
  );
}

function statefulEdit() {
  return vi.fn(
    async (
      id: string,
      patch: Parameters<PromptStoreState["edit"]>[1]
    ): Promise<void> => {
      usePromptStore.setState((state) => ({
        items: state.items.map((item) =>
          item.id === id
            ? {
                ...item,
                ...patch,
                updatedAt: "2026-08-18T02:00:00.000Z",
              }
            : item
        ),
      }));
    }
  );
}

function statefulRemove() {
  return vi.fn(async (id: string): Promise<void> => {
    usePromptStore.setState((state) => ({
      items: state.items.filter((item) => item.id !== id),
    }));
  });
}

beforeEach(async () => {
  usePromptStore.setState(initialPromptStoreState, true);
  usePromptRecentStore.setState(initialPromptRecentState, true);
  await i18n.changeLanguage("en");
  setPromptStore([]);
});

afterEach(() => {
  usePromptStore.setState(initialPromptStoreState, true);
  usePromptRecentStore.setState(initialPromptRecentState, true);
  vi.restoreAllMocks();
});

describe("PromptManagerDialog", () => {
  it("offers a direct create path from the empty state and saves normalized fields", async () => {
    const user = userEvent.setup();
    const add = statefulAdd("created");
    setPromptStore([], { add });

    render(<PromptManagerDialog open onOpenChange={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: "Create your first prompt" })
    );
    await user.type(screen.getByLabelText("Name"), "  Release review  ");
    await user.type(screen.getByLabelText("Description"), "Before shipping");
    await user.type(screen.getByLabelText("Prompt content"), "  Check this  ");
    await user.type(screen.getByLabelText("Tags"), "release, Review, release");
    await user.type(
      screen.getByLabelText("Source URL"),
      " https://example.test/prompt "
    );
    await user.click(screen.getByRole("switch", { name: "Favorite" }));
    await user.click(screen.getByRole("button", { name: "Save prompt" }));

    expect(add).toHaveBeenCalledWith({
      name: "Release review",
      description: "Before shipping",
      content: "Check this",
      tags: ["release", "Review"],
      sourceUrl: "https://example.test/prompt",
      favorite: true,
    });
    expect(screen.queryByText("No prompts yet.")).toBeNull();
    expect(screen.getByText("Release review")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Edit prompt" })
    ).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Release review"
    );
    expect(
      screen
        .getByRole("switch", { name: "Favorite" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("does not retry a failed load in a loop while the dialog stays open", async () => {
    const load = vi.fn(async () => {
      if (load.mock.calls.length === 1) {
        usePromptStore.setState({ loading: true });
        await Promise.resolve();
        usePromptStore.setState({
          loading: false,
          error: "storage unavailable",
        });
      }
    });
    setPromptStore([], { loaded: false, load });

    render(<PromptManagerDialog open onOpenChange={vi.fn()} />);

    expect(await screen.findByText("Could not load prompts.")).toBeTruthy();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("shows localized validation errors without calling persistence", async () => {
    const user = userEvent.setup();
    const add = vi.fn().mockResolvedValue(undefined);
    setPromptStore([], { add });

    render(<PromptManagerDialog open onOpenChange={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: "Create your first prompt" })
    );
    await user.type(screen.getByLabelText("Source URL"), "file:///tmp/prompt");
    await user.click(screen.getByRole("button", { name: "Save prompt" }));

    expect(screen.getByText("Name is required.")).toBeTruthy();
    expect(screen.getByText("Prompt content is required.")).toBeTruthy();
    expect(
      screen.getByText("Enter an HTTP or HTTPS source URL.")
    ).toBeTruthy();
    expect(add).not.toHaveBeenCalled();
  });

  it("preserves draft values and shows a concise error when saving fails", async () => {
    const user = userEvent.setup();
    setPromptStore([], {
      add: vi.fn().mockRejectedValue(new Error("disk unavailable")),
    });

    render(<PromptManagerDialog open onOpenChange={vi.fn()} />);

    await user.click(
      screen.getByRole("button", { name: "Create your first prompt" })
    );
    await user.type(screen.getByLabelText("Name"), "Failure draft");
    await user.type(screen.getByLabelText("Prompt content"), "Keep this body");
    await user.click(screen.getByRole("button", { name: "Save prompt" }));

    expect(await screen.findByText("Could not save the prompt.")).toBeTruthy();
    expect(
      (screen.getByLabelText("Name") as HTMLInputElement).value
    ).toBe("Failure draft");
    expect(
      (screen.getByLabelText("Prompt content") as HTMLTextAreaElement).value
    ).toBe("Keep this body");
  });

  it("saves a normalized edit and keeps the refreshed prompt selected", async () => {
    const user = userEvent.setup();
    const edit = statefulEdit();
    setPromptStore(
      [
        prompt("alpha", "Alpha"),
        prompt("beta", "Beta", {
          description: "Original description",
          content: "Original body",
          tags: ["old"],
          sourceUrl: "https://example.test/original",
        }),
      ],
      { edit }
    );

    render(<PromptManagerDialog open onOpenChange={vi.fn()} />);

    await screen.findByLabelText("Name");
    await user.click(
      screen.getByRole("button", { name: "BetaOriginal description" })
    );
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "  Zulu revised  ");
    await user.clear(screen.getByLabelText("Description"));
    await user.type(screen.getByLabelText("Description"), "  Updated usage  ");
    await user.clear(screen.getByLabelText("Prompt content"));
    await user.type(screen.getByLabelText("Prompt content"), "  Updated body  ");
    await user.clear(screen.getByLabelText("Tags"));
    await user.type(screen.getByLabelText("Tags"), "review, Critical, REVIEW");
    await user.clear(screen.getByLabelText("Source URL"));
    await user.type(
      screen.getByLabelText("Source URL"),
      " https://example.test/revised "
    );
    await user.click(screen.getByRole("button", { name: "Save prompt" }));

    expect(edit).toHaveBeenCalledWith("beta", {
      name: "Zulu revised",
      description: "Updated usage",
      content: "Updated body",
      tags: ["review", "Critical"],
      sourceUrl: "https://example.test/revised",
      favorite: false,
    });

    await act(async () => {
      usePromptStore.setState((state) => ({
        items: state.items.map((item) => ({ ...item })),
      }));
    });

    expect(screen.getByText("Zulu revised")).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Zulu revised"
    );
    expect(
      (screen.getByLabelText("Prompt content") as HTMLTextAreaElement).value
    ).toBe("Updated body");
    expect((screen.getByLabelText("Tags") as HTMLInputElement).value).toBe(
      "review, Critical"
    );
  });

  it("favorites through edit and refreshes both the list action and editor", async () => {
    const user = userEvent.setup();
    const edit = statefulEdit();
    setPromptStore([prompt("alpha", "Alpha")], { edit });

    render(<PromptManagerDialog open onOpenChange={vi.fn()} />);

    await screen.findByLabelText("Name");
    await user.click(
      screen.getByRole("button", { name: "Favorite Alpha" })
    );

    expect(edit).toHaveBeenCalledWith("alpha", { favorite: true });
    expect(
      await screen.findByRole("button", {
        name: "Remove Alpha from favorites",
      })
    ).toBeTruthy();
    expect(
      screen
        .getByRole("switch", { name: "Favorite" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(screen.getAllByText("Favorite")).toHaveLength(2);
  });

  it("requires confirmation before deleting and refreshes to a coherent empty state", async () => {
    const user = userEvent.setup();
    const remove = statefulRemove();
    setPromptStore([prompt("alpha", "Alpha")], { remove });

    render(<PromptManagerDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Delete Alpha" }));
    expect(remove).not.toHaveBeenCalled();
    const confirmation = screen.getByRole("alertdialog");
    expect(
      within(confirmation).getByText(
        'Delete "Alpha"? This action cannot be undone.'
      )
    ).toBeTruthy();
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete" })
    );

    expect(remove).toHaveBeenCalledWith("alpha");
    await waitFor(() => {
      expect(screen.getByText("No prompts yet.")).toBeTruthy();
    });
    expect(
      screen.getByText("Select a prompt or create a new one.")
    ).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });
});

describe("PromptPicker", () => {
  it("has an accessible trigger and renders deterministic, duplicate-free empty-query sections", async () => {
    const user = userEvent.setup();
    const prompts = [
      prompt("z", "Zulu", { favorite: true, tags: ["one", "two", "three"] }),
      prompt("recent", "Bravo", { description: "Recently used" }),
      prompt("a", "Alpha"),
    ];
    usePromptRecentStore.setState({
      recentPromptIds: ["z", "recent"],
    });

    render(
      <PromptPicker
        prompts={prompts}
        onApply={vi.fn()}
        onManage={vi.fn()}
      />
    );

    const trigger = screen.getByRole("button", { name: "Prompts" });
    expect(trigger.getAttribute("title")).toBe("Prompts");
    await user.click(trigger);

    const search = screen.getByRole("textbox", { name: "Search prompts" });
    expect(document.activeElement).toBe(search);
    expect(
      within(screen.getByRole("group", { name: "Favorites" })).getByText(
        "Zulu"
      )
    ).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: "Recent" })).getByText("Bravo")
    ).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: "All prompts" })).getByText(
        "Alpha"
      )
    ).toBeTruthy();
    expect(screen.getAllByText("Zulu")).toHaveLength(1);
    expect(screen.getAllByText("Bravo")).toHaveLength(1);
    expect(screen.getAllByText("one")).toHaveLength(1);
    expect(screen.getAllByText("two")).toHaveLength(1);
    expect(screen.queryByText("three")).toBeNull();
  });

  it("searches visible fields but excludes body content and collapses to one ordered list", async () => {
    const user = userEvent.setup();
    const prompts = [
      prompt("body", "Body only", { content: "needle" }),
      prompt("description", "Zulu", { description: "needle" }),
      prompt("tag", "Charlie", { tags: ["Needle"] }),
      prompt("favorite", "Bravo", {
        description: "NEEDLE",
        favorite: true,
      }),
      prompt("name", "Needle Alpha"),
    ];

    render(
      <PromptPicker
        prompts={prompts}
        onApply={vi.fn()}
        onManage={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Prompts" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search prompts" }),
      "needle"
    );

    expect(screen.queryByRole("group", { name: "Favorites" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
    const rows = screen.getAllByTestId("prompt-picker-row");
    expect(rows.map((row) => row.getAttribute("data-prompt-id"))).toEqual([
      "favorite",
      "tag",
      "name",
      "description",
    ]);
    expect(screen.queryByText("Body only")).toBeNull();
  });

  it("applies the active row with ArrowDown and Enter, records recent use, and closes", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();

    render(
      <PromptPicker
        prompts={[prompt("beta", "Beta"), prompt("alpha", "Alpha")]}
        onApply={onApply}
        onManage={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Prompts" }));
    screen.getByRole("textbox", { name: "Search prompts" });
    await user.keyboard("{ArrowDown}{Enter}");

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "beta" })
    );
    expect(usePromptRecentStore.getState().recentPromptIds).toEqual(["beta"]);
    expect(
      screen.queryByRole("textbox", { name: "Search prompts" })
    ).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Prompts" })
    );
  });

  it("closes on Escape without applying and still exposes Manage for an empty library", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onManage = vi.fn();

    render(
      <PromptPicker prompts={[]} onApply={onApply} onManage={onManage} />
    );

    await user.click(screen.getByRole("button", { name: "Prompts" }));
    expect(
      screen.getByRole("menuitem", { name: "Manage prompts" })
    ).toBeTruthy();
    await user.keyboard("{Escape}");

    expect(onApply).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: "Search prompts" })
    ).toBeNull();
  });

  it("shows loading and load-error states without presenting an empty library", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <PromptPicker
        prompts={[]}
        loading
        onApply={vi.fn()}
        onManage={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Prompts" }));
    expect(screen.getByText("Loading prompts...")).toBeTruthy();
    expect(screen.queryByText("No prompts yet.")).toBeNull();

    rerender(
      <PromptPicker
        prompts={[]}
        error="storage unavailable"
        onApply={vi.fn()}
        onManage={vi.fn()}
      />
    );

    expect(screen.getByText("Could not load prompts.")).toBeTruthy();
    expect(screen.queryByText("No prompts yet.")).toBeNull();
  });
});
