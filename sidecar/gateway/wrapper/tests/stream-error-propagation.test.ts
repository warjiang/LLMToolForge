import { describe, expect, test } from "bun:test";

import { handleStreamingMode } from "../../portkey/src/handlers/streamHandler.ts";

describe("handleStreamingMode", () => {
  test("propagates upstream stream read failures to the response consumer", async () => {
    const upstreamError = new Error("upstream broke");
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(upstreamError);
      },
    });
    const upstream = new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const transformed = handleStreamingMode(
      upstream,
      "openai",
      undefined,
      "/v1/chat/completions",
      false,
      {} as never,
      "chatComplete" as never,
      undefined,
    );

    await expect(transformed.text()).rejects.toThrow("upstream broke");
  });
});
