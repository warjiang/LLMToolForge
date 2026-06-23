import type {
  VideoGenerationReference,
  VideoGenerationResult,
  VideoGenerationVideo,
} from "@/lib/providers/types";

export type VideoContentItem =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string };
      role: "reference_image";
    }
  | {
      type: "video_url";
      video_url: { url: string };
      role: "reference_video";
    }
  | {
      type: "audio_url";
      audio_url: { url: string };
      role: "reference_audio";
    };

export interface VideoGenerationApiResponse {
  id?: string;
  task_id?: string;
  taskId?: string;
  status?: string;
  video_url?: string;
  videoUrl?: string;
  last_frame_url?: string;
  lastFrameUrl?: string;
  data?: VideoGenerationApiResponse;
  result?: VideoGenerationApiResponse;
  content?: VideoGenerationApiResponse | VideoGenerationApiResponse[];
  output?: VideoGenerationApiResponse | VideoGenerationApiResponse[];
}

function contentItemFromReference(ref: VideoGenerationReference): VideoContentItem {
  if (ref.kind === "image") {
    return {
      type: "image_url",
      image_url: { url: ref.url },
      role: ref.role === "reference_image" ? ref.role : "reference_image",
    };
  }
  if (ref.kind === "video") {
    return {
      type: "video_url",
      video_url: { url: ref.url },
      role: ref.role === "reference_video" ? ref.role : "reference_video",
    };
  }
  return {
    type: "audio_url",
    audio_url: { url: ref.url },
    role: ref.role === "reference_audio" ? ref.role : "reference_audio",
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function nestedResponses(
  json: VideoGenerationApiResponse
): VideoGenerationApiResponse[] {
  return [
    json,
    json.data,
    json.result,
    ...(Array.isArray(json.content) ? json.content : [json.content]),
    ...(Array.isArray(json.output) ? json.output : [json.output]),
  ].filter(Boolean) as VideoGenerationApiResponse[];
}

function extractTaskId(json: VideoGenerationApiResponse): string | undefined {
  for (const item of nestedResponses(json)) {
    const id = firstString(item.id, item.task_id, item.taskId);
    if (id) return id;
  }
  return undefined;
}

function extractStatus(json: VideoGenerationApiResponse): string | undefined {
  for (const item of nestedResponses(json)) {
    const status = firstString(item.status);
    if (status) return status;
  }
  return undefined;
}

function extractVideos(json: VideoGenerationApiResponse): VideoGenerationVideo[] {
  return nestedResponses(json)
    .map((item) => ({
      url: firstString(item.video_url, item.videoUrl),
      lastFrameUrl: firstString(item.last_frame_url, item.lastFrameUrl),
      mime: "video/mp4",
    }))
    .filter((video) => video.url);
}

export function videoContentItems(
  prompt: string,
  references: VideoGenerationReference[] | undefined
): VideoContentItem[] {
  return [
    { type: "text", text: prompt },
    ...((references ?? []).map(contentItemFromReference)),
  ];
}

export function videoResultFromResponse(
  json: VideoGenerationApiResponse
): VideoGenerationResult {
  return {
    taskId: extractTaskId(json),
    status: extractStatus(json),
    videos: extractVideos(json),
    raw: json,
  };
}
