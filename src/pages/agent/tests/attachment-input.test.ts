import { describe, expect, test } from "vitest";
import type { ChatAttachment } from "@/types/chat";
import {
  clearResolvedImageInputError,
  filterAttachmentsForImageInput,
  filterFilesForImageInput,
} from "../attachmentInput";

function file(name: string, type: string): File {
  return new File(["x"], name, { type });
}

function attachment(
  id: string,
  kind: ChatAttachment["kind"],
  mime: string
): ChatAttachment {
  return {
    id,
    sessionId: "session",
    kind,
    name: `${id}.dat`,
    mime,
    size: 1,
    createdAt: "2026-08-04T00:00:00.000Z",
  };
}

describe("attachment input capability filtering", () => {
  test("keeps image files when the selected model supports image input", () => {
    const image = file("screen.png", "image/png");
    const document = file("notes.txt", "text/plain");

    const result = filterFilesForImageInput([image, document], true);

    expect(result.acceptedFiles).toEqual([image, document]);
    expect(result.rejectedImageCount).toBe(0);
  });

  test("rejects only image files when the selected model is text-only", () => {
    const image = file("screen.png", "image/png");
    const document = file("notes.txt", "text/plain");

    const result = filterFilesForImageInput([image, document], false);

    expect(result.acceptedFiles).toEqual([document]);
    expect(result.rejectedImageCount).toBe(1);
  });

  test("treats common image extensions as images when the browser omits mime type", () => {
    const image = file("diagram.webp", "");
    const document = file("diagram.txt", "");

    const result = filterFilesForImageInput([image, document], false);

    expect(result.acceptedFiles).toEqual([document]);
    expect(result.rejectedImageCount).toBe(1);
  });

  test("removes only pending image attachments after switching to a text-only model", () => {
    const screenshot = attachment("img", "image", "image/png");
    const document = attachment("doc", "file", "text/plain");
    const audio = attachment("audio", "audio", "audio/mpeg");

    const result = filterAttachmentsForImageInput(
      [screenshot, document, audio],
      false
    );

    expect(result.acceptedAttachments).toEqual([document, audio]);
    expect(result.removedImageCount).toBe(1);
  });

  test("clears the image input error after switching to an image-capable model", () => {
    const result = clearResolvedImageInputError({
      currentError: "no image input",
      imageInputError: "no image input",
      supportsImageInput: true,
      sessionChanged: false,
    });

    expect(result).toBeNull();
  });

  test("clears the image input error after changing sessions", () => {
    const result = clearResolvedImageInputError({
      currentError: "no image input",
      imageInputError: "no image input",
      supportsImageInput: false,
      sessionChanged: true,
    });

    expect(result).toBeNull();
  });

  test("does not clear unrelated errors when model capability or session changes", () => {
    const result = clearResolvedImageInputError({
      currentError: "network failed",
      imageInputError: "no image input",
      supportsImageInput: true,
      sessionChanged: true,
    });

    expect(result).toBe("network failed");
  });
});
