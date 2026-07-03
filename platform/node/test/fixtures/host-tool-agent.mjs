/**
 * Test fixture: an agent that calls a host tool and streams the bridged result.
 * No model call — verifies the AAP reverse bridge (host_tool_call/result) and
 * that `ctx.hostTools` is populated from `init`.
 */
import { run } from "../../src/runtime.js";

run({
  name: "host-tool-agent",
  async onPrompt(ctx) {
    ctx.assistantStart();
    // Advertise what the host offered, so the test can assert manifest delivery.
    ctx.assistantDelta(`tools=${ctx.hostTools.map((t) => t.name).join(",")};`);
    const res = await ctx.callHostTool("echo_host", { msg: ctx.input });
    ctx.assistantDelta(`result=${res.resultText}`);
    ctx.assistantEnd(`result=${res.resultText}`);
  },
});
