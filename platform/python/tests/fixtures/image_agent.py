"""Test fixture: echoes the native images it received on the prompt (v2)."""

from llmtoolforge_agent import run


def on_prompt(ctx):
    ctx.assistant_start()
    summary = ";".join(
        f"{im.get('mimeType')}:{im.get('data')}" for im in ctx.images
    )
    ctx.assistant_delta(f"images={len(ctx.images)}|{summary}")
    ctx.assistant_end(f"images={len(ctx.images)}")


if __name__ == "__main__":
    run(on_prompt, name="image-agent")
