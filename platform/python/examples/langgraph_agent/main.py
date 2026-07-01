#!/usr/bin/env python3
"""LangGraph example agent.

Streams a LangGraph ReAct agent's model tokens and tool calls through the
internal Unified gateway, mapping LangChain callbacks to AAP events via the SDK
adapter. The host injects UNIFIED_BASE_URL / UNIFIED_API_KEY / UNIFIED_MODEL and
also provides them in the ``init`` config.

Install deps in an isolated env before running (done by the host at install)::

    uv venv && uv pip install -e .
"""

from __future__ import annotations

from llmtoolforge_agent import run, model_config
from llmtoolforge_agent.adapters.langchain import AAPCallbackHandler


def on_prompt(ctx) -> None:
    from langchain_openai import ChatOpenAI

    cfg = model_config(ctx.config)
    llm = ChatOpenAI(
        base_url=cfg.base_url,
        api_key=cfg.api_key,
        model=cfg.model,
        temperature=(ctx.config or {}).get("temperature", 0.7),
        streaming=True,
    )

    handler = AAPCallbackHandler(ctx)

    messages = []
    system = (ctx.config or {}).get("systemPrompt")
    if system:
        messages.append(("system", system))
    for m in ctx.history:
        messages.append((m["role"], m["content"]))
    messages.append(("user", ctx.input))

    # A single streamed model turn. (Swap in a full LangGraph graph as needed;
    # the same callback handler streams graph node LLM tokens the same way.)
    result = llm.invoke(messages, config={"callbacks": [handler]})
    handler.finalize(getattr(result, "content", "") or "")


if __name__ == "__main__":
    run(on_prompt, name="langgraph-agent")
