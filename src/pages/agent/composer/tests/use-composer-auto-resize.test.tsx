import { act, render, screen } from "@testing-library/react";
import { useRef } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  composerHeight,
  fitComposerHeightWithinBoundary,
  useComposerAutoResize,
} from "@/pages/agent/composer/useComposerAutoResize";

interface ComposerHarnessProps {
  value: string;
  expanded: boolean;
  scrollHeight: number;
}

let resizeObserverCallback: ResizeObserverCallback | null = null;

function setViewportHeight(height: number) {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

function ComposerHarness({
  value,
  expanded,
  scrollHeight,
}: ComposerHarnessProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useComposerAutoResize({ textareaRef, value, expanded });

  return (
    <section data-agent-composer-boundary aria-label="Boundary">
      <div data-agent-composer-footer>
        <div>
          <textarea
            ref={textareaRef}
            aria-label="Composer"
            data-scroll-height={scrollHeight}
            value={value}
            readOnly
          />
        </div>
        <div data-agent-composer-toolbar />
      </div>
    </section>
  );
}

describe("composerHeight", () => {
  it("caps compact mode at 30 percent of the viewport or 240px", () => {
    expect(composerHeight(900, false)).toBe(240);
    expect(composerHeight(600, false)).toBe(180);
  });

  it("clamps expanded mode between 240px and 560px", () => {
    expect(composerHeight(600, true)).toBe(330);
    expect(composerHeight(300, true)).toBe(240);
    expect(composerHeight(1400, true)).toBe(560);
  });

  it("reduces focused height when the composer footer would overflow", () => {
    expect(fitComposerHeightWithinBoundary(250, 81)).toBe(169);
    expect(fitComposerHeightWithinBoundary(250, 0)).toBe(250);
    expect(fitComposerHeightWithinBoundary(80, 100)).toBe(52);
  });
});

describe("useComposerAutoResize", () => {
  beforeEach(() => {
    setViewportHeight(900);
    resizeObserverCallback = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeObserverCallback = callback;
        }

        observe() {}

        disconnect() {}
      }
    );
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return Number(this.dataset.scrollHeight ?? 0);
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps short input at the compact minimum", () => {
    render(<ComposerHarness value="Short" expanded={false} scrollHeight={32} />);

    const textarea = screen.getByRole("textbox", { name: "Composer" });
    expect(textarea.style.height).toBe("52px");
    expect(textarea.style.overflowY).toBe("hidden");
  });

  it("grows with content below the compact cap", () => {
    render(
      <ComposerHarness
        value={"Line\n".repeat(6)}
        expanded={false}
        scrollHeight={140}
      />
    );

    const textarea = screen.getByRole("textbox", { name: "Composer" });
    expect(textarea.style.height).toBe("140px");
    expect(textarea.style.overflowY).toBe("hidden");
  });

  it("scrolls internally when content exceeds the compact cap", () => {
    render(
      <ComposerHarness
        value={"Line\n".repeat(20)}
        expanded={false}
        scrollHeight={500}
      />
    );

    const textarea = screen.getByRole("textbox", { name: "Composer" });
    expect(textarea.style.height).toBe("240px");
    expect(textarea.style.overflowY).toBe("auto");
  });

  it("allocates focused height and returns to content height on collapse", () => {
    const { rerender } = render(
      <ComposerHarness value="Short" expanded scrollHeight={120} />
    );
    const textarea = screen.getByRole("textbox", { name: "Composer" });
    expect(textarea.style.height).toBe("495px");
    expect(textarea.style.overflowY).toBe("hidden");

    rerender(
      <ComposerHarness value="Short" expanded={false} scrollHeight={120} />
    );
    expect(textarea.style.height).toBe("120px");
    expect(textarea.style.overflowY).toBe("hidden");
  });

  it("recalculates the compact cap after viewport resize", () => {
    setViewportHeight(600);
    render(
      <ComposerHarness
        value={"Line\n".repeat(20)}
        expanded={false}
        scrollHeight={500}
      />
    );
    const textarea = screen.getByRole("textbox", { name: "Composer" });
    expect(textarea.style.height).toBe("180px");

    act(() => {
      setViewportHeight(1000);
      window.dispatchEvent(new Event("resize"));
    });

    expect(textarea.style.height).toBe("240px");
    expect(textarea.style.overflowY).toBe("auto");
  });

  it("recalculates when the Agent pane geometry changes", () => {
    setViewportHeight(600);
    render(
      <ComposerHarness
        value={"Line\n".repeat(20)}
        expanded={false}
        scrollHeight={500}
      />
    );
    const textarea = screen.getByRole("textbox", { name: "Composer" });
    const boundary = screen.getByRole("region", { name: "Boundary" });
    expect(textarea.style.height).toBe("180px");
    expect(resizeObserverCallback).not.toBeNull();

    Object.defineProperty(boundary, "clientWidth", {
      configurable: true,
      value: 900,
    });
    act(() => {
      setViewportHeight(1000);
      resizeObserverCallback?.([], {} as ResizeObserver);
    });

    expect(textarea.style.height).toBe("240px");
  });
});
