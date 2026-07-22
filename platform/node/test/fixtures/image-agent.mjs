/**
 * Test fixture: echoes the native images it received on the prompt (v2).
 */
import { run } from "../../src/runtime.js";

run({
  name: "image-agent",
  async onPrompt(ctx) {
    ctx.assistantStart();
    const summary = ctx.images
      .map((im) => `${im.mimeType}:${im.data}`)
      .join(";");
    ctx.assistantDelta(`images=${ctx.images.length}|${summary}`);
    ctx.assistantEnd(`images=${ctx.images.length}`);
  },
});
