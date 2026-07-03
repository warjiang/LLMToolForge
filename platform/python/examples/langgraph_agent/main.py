#!/usr/bin/env python3
"""LangGraph example agent.

Streams a LangGraph ReAct agent's model tokens and tool calls through the
internal Unified gateway, mapping LangChain callbacks to AAP events via the SDK
adapter. The host injects UNIFIED_BASE_URL / UNIFIED_API_KEY / UNIFIED_MODEL and
also provides them in the ``init`` config, plus any host tools the agent may
call back into the app.

Install deps in an isolated env before running (done by the host at install)::

    uv venv && uv pip install -e .
"""

from __future__ import annotations

from llmtoolforge_agent import run, model_config
from llmtoolforge_agent.adapters.langchain import (
    AAPCallbackHandler,
    host_tools_for_langchain,
)


def on_prompt(ctx) -> None:
    from langchain_openai import ChatOpenAI

    cfg = model_config(ctx.config)
    llm = ChatOpenAI(
        base_url=cfg.base_url,
        api_key=cfg.api_key,
        model=cfg.model,
        temperature=cfg.temperature if cfg.temperature is not None else 0.7,
        default_headers=cfg.headers,
        streaming=True,
    )

    handler = AAPCallbackHandler(ctx)

    system = (ctx.config or {}).get("systemPrompt")
    tools = host_tools_for_langchain(ctx)

    if tools:
        # Full LangGraph ReAct loop: the model may call host tools (bash/fs/grep/
        # web_fetch/MCP/skills), each bridged back to the app via ctx.
        from langgraph.prebuilt import create_react_agent

        messages = []
        if system:
            messages.append(("system", system))
        for m in ctx.history:
            messages.append((m["role"], m["content"]))
        messages.append(("user", ctx.input))

        agent = create_react_agent(llm, tools)
        final = ""
        for chunk in agent.stream(
            {"messages": messages},
            config={"callbacks": [handler]},
            stream_mode="values",
        ):
            msgs = chunk.get("messages") or []
            if msgs:
                content = getattr(msgs[-1], "content", "")
                if isinstance(content, str):
                    final = content
        handler.finalize(final)
        return

    # No host tools: a single streamed model turn.
    messages = []
    if system:
        messages.append(("system", system))
    for m in ctx.history:
        messages.append((m["role"], m["content"]))
    messages.append(("user", ctx.input))
    result = llm.invoke(messages, config={"callbacks": [handler]})
    handler.finalize(getattr(result, "content", "") or "")


if __name__ == "__main__":
    run(on_prompt, name="langgraph-agent")
