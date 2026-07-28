import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/config";
import { BrowserPreview } from "@/components/agent/BrowserPreview";

type LoadingCallback = (loading: boolean) => void;

let loadingCallback: LoadingCallback | null = null;

const browserApi = vi.hoisted(() => ({
  browserBack: vi.fn(),
  browserForward: vi.fn(),
  browserReload: vi.fn(),
  browserStop: vi.fn().mockResolvedValue(undefined),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
  getBrowserStatus: vi.fn().mockResolvedValue({
    exists: false,
    url: null,
    canGoBack: false,
    canGoForward: false,
  }),
  onBrowserLoading: vi.fn((cb: LoadingCallback) => {
    loadingCallback = cb;
    return Promise.resolve(() => undefined);
  }),
  onBrowserNavigated: vi.fn((_cb: unknown) => {
    return Promise.resolve(() => undefined);
  }),
  openBrowser: vi.fn().mockResolvedValue(undefined),
  setBrowserBounds: vi.fn().mockResolvedValue(undefined),
  setBrowserPreviewVisible: vi.fn(),
}));

vi.mock("@/lib/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/utils")>();
  return {
    ...actual,
    isTauri: () => true,
  };
});

vi.mock("@/lib/browser", () => browserApi);

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useRealTimers();
  loadingCallback = null;
  browserApi.getBrowserStatus.mockResolvedValue({
    exists: false,
    url: null,
    canGoBack: false,
    canGoForward: false,
  });
  await i18n.changeLanguage("zh");
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 640,
      height: 360,
      right: 640,
      bottom: 360,
      toJSON: () => undefined,
    }),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("BrowserPreview loading controls", () => {
  it("shows a cancel action while loading and stops the native browser", async () => {
    const user = userEvent.setup();
    render(<BrowserPreview />);

    await user.type(screen.getByRole("textbox"), "http://localhost:52550");
    await user.click(screen.getByRole("button", { name: "前往" }));

    act(() => {
      loadingCallback?.(true);
    });

    await user.click(screen.getByRole("button", { name: "取消加载" }));

    expect(browserApi.browserStop).toHaveBeenCalledTimes(1);
  });

  it("stops a navigation that keeps loading beyond the timeout", async () => {
    vi.useFakeTimers();
    render(<BrowserPreview />);

    act(() => {
      loadingCallback?.(true);
    });
    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(browserApi.browserStop).toHaveBeenCalledTimes(1);
  });

  it("clears the current page and resets the browser preview state", async () => {
    browserApi.getBrowserStatus.mockResolvedValueOnce({
      exists: true,
      url: "http://localhost:5173/",
      canGoBack: true,
      canGoForward: false,
    });
    const user = userEvent.setup();
    render(<BrowserPreview />);

    await screen.findByDisplayValue("http://localhost:5173/");

    await user.click(screen.getByRole("button", { name: "清除当前网页" }));

    expect(browserApi.closeBrowser).toHaveBeenCalledTimes(1);
    expect(browserApi.setBrowserPreviewVisible).toHaveBeenCalledWith(false);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("在上方地址栏输入网址，或选择一个常用本地地址开始预览。")).toBeTruthy();
  });
});
