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
import {
  authHeader,
  endpoint,
  gatewayFetch,
  normalizeBaseUrl,
} from "./request";

async function postVideoTask(
  cred: ProviderCredential,
  body: unknown,
  signal?: AbortSignal
) {
  return gatewayFetch(endpoint(normalizeBaseUrl(cred), "contents/generations/tasks"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(cred),
    },
    body: JSON.stringify(body),
    signal,
  });
}

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

  const res = await postVideoTask(cred, body, req.signal);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Video 失败: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as VideoGenerationApiResponse;
  return videoResultFromResponse(json);
}

export async function getVideoGenerationTask(
  req: VideoGenerationTaskRequest,
  cred: ProviderCredential
): Promise<VideoGenerationResult> {
  const res = await gatewayFetch(
    endpoint(
      normalizeBaseUrl(cred),
      `contents/generations/tasks/${encodeURIComponent(req.taskId)}`
    ),
    {
      method: "GET",
      headers: {
        Authorization: authHeader(cred),
      },
      signal: req.signal,
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Video(task) 失败: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as VideoGenerationApiResponse;
  return videoResultFromResponse(json);
}
