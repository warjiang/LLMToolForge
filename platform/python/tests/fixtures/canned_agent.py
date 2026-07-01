"""Test fixture: a canned Python agent built on the SDK runtime, no model call."""

from llmtoolforge_agent import run


def on_prompt(ctx):
    ctx.assistant_start()
    ctx.reasoning_delta("deciding")
    for word in ["hello", " from", " canned", " agent"]:
        ctx.assistant_delta(word)
    ctx.assistant_end("hello from canned agent")


if __name__ == "__main__":
    run(on_prompt, name="canned-agent")
