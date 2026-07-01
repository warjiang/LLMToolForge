"""llmtoolforge-agent — build LLMToolForge external agents in Python.

Minimal usage::

    from llmtoolforge_agent import run

    def on_prompt(ctx):
        ctx.assistant_start()
        ctx.assistant_delta("hello")
        ctx.assistant_end("hello")

    run(on_prompt, name="my-agent")
"""

from .runtime import (
    AAP_MARKER,
    AAP_PROTOCOL_VERSION,
    TurnContext,
    run,
)
from .model import ModelConfig, model_config

__all__ = [
    "run",
    "TurnContext",
    "ModelConfig",
    "model_config",
    "AAP_MARKER",
    "AAP_PROTOCOL_VERSION",
]
