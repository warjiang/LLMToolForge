import {
  useCallback,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";

export const COMPOSER_MIN_HEIGHT = 52;
export const COMPOSER_COMPACT_VIEWPORT_RATIO = 0.3;
export const COMPOSER_COMPACT_MAX_HEIGHT = 240;
export const COMPOSER_EXPANDED_VIEWPORT_RATIO = 0.55;
export const COMPOSER_EXPANDED_MIN_HEIGHT = 240;
export const COMPOSER_EXPANDED_MAX_HEIGHT = 560;

interface ComposerAutoResizeOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  expanded: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function composerGeometry(textarea: HTMLTextAreaElement): string {
  const footer = textarea.closest<HTMLElement>("[data-agent-composer-footer]");
  const boundary = textarea.closest<HTMLElement>(
    "[data-agent-composer-boundary]"
  );
  const footerHeight = footer?.getBoundingClientRect().height ?? 0;
  const textareaHeight = textarea.getBoundingClientRect().height;
  const chromeHeight = Math.max(footerHeight - textareaHeight, 0);

  return [
    boundary?.clientWidth ?? 0,
    boundary?.clientHeight ?? 0,
    footer?.clientWidth ?? 0,
    Math.round(chromeHeight),
  ].join(":");
}

export function composerHeight(
  viewportHeight: number,
  expanded: boolean
): number {
  if (expanded) {
    return Math.round(
      clamp(
        viewportHeight * COMPOSER_EXPANDED_VIEWPORT_RATIO,
        COMPOSER_EXPANDED_MIN_HEIGHT,
        COMPOSER_EXPANDED_MAX_HEIGHT
      )
    );
  }

  return Math.round(
    clamp(
      viewportHeight * COMPOSER_COMPACT_VIEWPORT_RATIO,
      COMPOSER_MIN_HEIGHT,
      COMPOSER_COMPACT_MAX_HEIGHT
    )
  );
}

export function fitComposerHeightWithinBoundary(
  desiredHeight: number,
  overflowHeight: number
): number {
  return Math.max(
    COMPOSER_MIN_HEIGHT,
    desiredHeight - Math.max(overflowHeight, 0)
  );
}

export function useComposerAutoResize({
  textareaRef,
  value,
  expanded,
}: ComposerAutoResizeOptions): void {
  const geometryRef = useRef("");
  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = `${COMPOSER_MIN_HEIGHT}px`;

    const contentHeight = Math.max(
      textarea.scrollHeight,
      COMPOSER_MIN_HEIGHT
    );
    const availableHeight = composerHeight(window.innerHeight, expanded);
    let nextHeight = expanded
      ? availableHeight
      : Math.min(contentHeight, availableHeight);

    textarea.style.height = `${nextHeight}px`;
    if (expanded) {
      const footer = textarea.closest<HTMLElement>(
        "[data-agent-composer-footer]"
      );
      const boundary = textarea.closest<HTMLElement>(
        "[data-agent-composer-boundary]"
      );
      if (footer && boundary) {
        const overflowHeight = Math.ceil(
          footer.getBoundingClientRect().bottom -
            boundary.getBoundingClientRect().bottom
        );
        nextHeight = fitComposerHeightWithinBoundary(
          nextHeight,
          overflowHeight
        );
        textarea.style.height = `${nextHeight}px`;
      }
    }
    textarea.style.overflowY =
      contentHeight > nextHeight ? "auto" : "hidden";
    geometryRef.current = composerGeometry(textarea);
  }, [expanded, textareaRef]);

  useLayoutEffect(() => {
    resize();
  }, [resize, value]);

  useLayoutEffect(() => {
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || typeof ResizeObserver === "undefined") return;

    const footer = textarea.closest<HTMLElement>(
      "[data-agent-composer-footer]"
    );
    const boundary = textarea.closest<HTMLElement>(
      "[data-agent-composer-boundary]"
    );
    const observer = new ResizeObserver(() => {
      if (composerGeometry(textarea) !== geometryRef.current) {
        resize();
      }
    });

    if (footer) observer.observe(footer);
    if (boundary) observer.observe(boundary);
    return () => observer.disconnect();
  }, [resize, textareaRef]);
}
