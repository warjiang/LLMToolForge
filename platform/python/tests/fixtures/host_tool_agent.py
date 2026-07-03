"""Test fixture: a Python agent that calls a host tool and streams the result.

No model call — verifies the AAP reverse bridge (host_tool_call/result) and that
``ctx.host_tools`` is populated from ``init``.
"""

from llmtoolforge_agent import run


def on_prompt(ctx):
    ctx.assistant_start()
    names = ",".join(t.get("name", "") for t in ctx.host_tools)
    ctx.assistant_delta(f"tools={names};")
    res = ctx.call_host_tool("echo_host", {"msg": ctx.input})
    ctx.assistant_end(f"result={res['resultText']}")


if __name__ == "__main__":
    run(on_prompt, name="host-tool-agent")
