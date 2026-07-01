/**
 * Test fixture: a canned agent built on the SDK runtime, no model call.
 * Streams a fixed reply so the runtime loop can be verified deterministically.
 */
import { run } from "../../src/runtime.js";

run({
  name: "canned-agent",
  async onPrompt(ctx) {
    ctx.assistantStart();
    ctx.reasoningDelta("deciding");
    for (const w of ["hello", " from", " canned", " agent"]) {
      ctx.assistantDelta(w);
    }
    ctx.assistantEnd("hello from canned agent");
  },
});
