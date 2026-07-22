/**
 * Shared helpers for carrying user-attached images into the Agent runtimes.
 *
 * Both the built-in Pi runtime and the external (AAP) runtime accept a
 * normalized, prefix-stripped image payload so a vision-capable model can see
 * the image natively (as an OpenAI `image_url` part) instead of only receiving
 * a file-path text reference. The wire/transport shape here is intentionally
 * decoupled from the pi-ai `ImageContent` structural type (no `type:"image"`
 * tag) so it is JSON-safe across the stdio boundary to external agents.
 */

import type { ChatAttachment } from "@/types/chat";

/** A normalized image ready to hand to a runtime: base64 without the data-URL prefix. */
export interface AgentPromptImage {
  /** Base64 payload only, i.e. the part after `data:<mime>;base64,`. */
  data: string;
  /** MIME type, e.g. `image/png`. */
  mimeType: string;
}

const DATA_URL_RE = /^data:(.+?);base64,(.*)$/s;

/**
 * Parse a base64 data URL (`data:image/png;base64,<...>`) into an
 * {@link AgentPromptImage}. Returns `null` for non-base64 / malformed input.
 * Uses a regex (not `split(",")`) so commas inside the payload can't break it.
 */
export function dataUrlToPromptImage(dataUrl: string): AgentPromptImage | null {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  const [, mimeType, data] = match;
  if (!mimeType || !data) return null;
  return { data, mimeType };
}

/**
 * Convert chat attachments into native prompt images. Only image attachments
 * that carry a decodable base64 `dataUrl` are included; everything else
 * (non-image kinds, malformed data URLs) is dropped so it can still surface via
 * the file-path text context.
 */
export function attachmentsToPromptImages(
  attachments: ChatAttachment[]
): AgentPromptImage[] {
  const images: AgentPromptImage[] = [];
  for (const attachment of attachments) {
    if (attachment.kind !== "image" || !attachment.dataUrl) continue;
    const image = dataUrlToPromptImage(attachment.dataUrl);
    if (image) images.push(image);
  }
  return images;
}
