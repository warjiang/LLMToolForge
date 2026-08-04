import type { ChatAttachment } from "@/types/chat";

const IMAGE_EXT_RE = /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i;

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_EXT_RE.test(file.name);
}

function isImageAttachment(attachment: ChatAttachment): boolean {
  return attachment.kind === "image" || attachment.mime.startsWith("image/");
}

export interface FileImageInputFilterResult {
  acceptedFiles: File[];
  rejectedImageCount: number;
}

export function filterFilesForImageInput(
  files: File[],
  supportsImageInput: boolean
): FileImageInputFilterResult {
  if (supportsImageInput) {
    return { acceptedFiles: files, rejectedImageCount: 0 };
  }

  const acceptedFiles: File[] = [];
  let rejectedImageCount = 0;
  for (const file of files) {
    if (isImageFile(file)) {
      rejectedImageCount += 1;
    } else {
      acceptedFiles.push(file);
    }
  }
  return { acceptedFiles, rejectedImageCount };
}

export interface AttachmentImageInputFilterResult {
  acceptedAttachments: ChatAttachment[];
  removedImageCount: number;
}

export function filterAttachmentsForImageInput(
  attachments: ChatAttachment[],
  supportsImageInput: boolean
): AttachmentImageInputFilterResult {
  if (supportsImageInput) {
    return { acceptedAttachments: attachments, removedImageCount: 0 };
  }

  const acceptedAttachments: ChatAttachment[] = [];
  let removedImageCount = 0;
  for (const attachment of attachments) {
    if (isImageAttachment(attachment)) {
      removedImageCount += 1;
    } else {
      acceptedAttachments.push(attachment);
    }
  }
  return { acceptedAttachments, removedImageCount };
}

export interface ClearImageInputErrorInput {
  currentError: string | null;
  imageInputError: string;
  supportsImageInput: boolean;
  sessionChanged: boolean;
}

export function clearResolvedImageInputError({
  currentError,
  imageInputError,
  supportsImageInput,
  sessionChanged,
}: ClearImageInputErrorInput): string | null {
  if (currentError !== imageInputError) return currentError;
  return supportsImageInput || sessionChanged ? null : currentError;
}
