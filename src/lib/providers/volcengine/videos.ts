import type {
  ProviderCredential,
  VideoGenerationTaskRequest,
  VideoGenerationRequest,
  VideoGenerationResult,
} from "@/lib/providers/types";
import {
  videoContentItems,
  videoResultFromResponse,
  type VideoGenerationApiResponse,
} from "@/lib/providers/videoGeneration";
import { ensureOk, getArkJson, postArkJson } from "./request";

export async function videoGeneration(
  req: VideoGenerationRequest,
  cred: ProviderCredential
): Promise<VideoGenerationResult> {
  const body: Record<string, unknown> = {
    model: req.model,
    content: videoContentItems(req.prompt, req.references),
    generate_audio: req.generateAudio ?? true,
    ratio: req.ratio ?? "16:9",
    duration: req.duration ?? 5,
    watermark: req.watermark ?? false,
  };

  const res = await postArkJson(
    cred,
    "/contents/generations/tasks",
    body,
    req.signal
  );
  await ensureOk(res, "Video");
  const json = (await res.json()) as VideoGenerationApiResponse;
  return videoResultFromResponse(json);
}

export async function getVideoGenerationTask(
  req: VideoGenerationTaskRequest,
  cred: ProviderCredential
): Promise<VideoGenerationResult> {
  const res = await getArkJson(
    cred,
    `/contents/generations/tasks/${encodeURIComponent(req.taskId)}`,
    req.signal
  );
  await ensureOk(res, "Video(task)");
  const json = (await res.json()) as VideoGenerationApiResponse;
  return videoResultFromResponse(json);
}
