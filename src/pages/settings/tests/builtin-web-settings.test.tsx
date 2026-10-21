import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false }),
  });
});

import i18n from "@/i18n/config";
import { BuiltinWebSettingsCard } from "@/pages/settings/BuiltinWebSettingsCard";
import { useBuiltinWebStore } from "@/store";

describe("Built-in Web settings", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useBuiltinWebStore.setState({
      config: {
        providerOrder: ["deepseek", "tavily", "local"],
        credentials: {},
      },
    });
  });

  it("shows a dedicated built-in Web Tools settings surface", () => {
    render(<BuiltinWebSettingsCard />);

    expect(
      screen.getByRole("heading", { name: "Built-in Web Tools" })
    ).toBeTruthy();
  });

  it("saves one masked provider key shared by the built-in tools", async () => {
    const user = userEvent.setup();
    render(<BuiltinWebSettingsCard />);

    const [deepSeekKey] = screen.getAllByLabelText("API key");
    expect((deepSeekKey as HTMLInputElement).type).toBe("password");
    await user.type(deepSeekKey, "deepseek-key");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      useBuiltinWebStore.getState().config.credentials.DEEPSEEK_API_KEY
    ).toBe("deepseek-key");
  });

  it("keeps edits in a draft until save and restores the persisted config on cancel", async () => {
    const user = userEvent.setup();
    render(<BuiltinWebSettingsCard />);

    const [deepSeekKey] = screen.getAllByLabelText("API key");
    await user.type(deepSeekKey, "discard-me");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect((deepSeekKey as HTMLInputElement).value).toBe("");
    expect(
      useBuiltinWebStore.getState().config.credentials.DEEPSEEK_API_KEY
    ).toBeUndefined();
  });

  it("persists a reordered provider priority while keeping local last", async () => {
    const user = userEvent.setup();
    render(<BuiltinWebSettingsCard />);

    await user.click(screen.getAllByTitle("Move provider down")[0]);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(useBuiltinWebStore.getState().config.providerOrder).toEqual([
      "tavily",
      "deepseek",
      "local",
    ]);
  });
});
