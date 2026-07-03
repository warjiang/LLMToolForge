"""LangChain / LangGraph adapter.

Bridges LangChain's streaming callbacks to AAP events on a
:class:`~llmtoolforge_agent.runtime.TurnContext`.

Import-safe: if ``langchain_core`` is installed the handler subclasses its
``BaseCallbackHandler`` (so it plugs straight into ``callbacks=[...]``);
otherwise it falls back to a plain object so the module still imports (and the
mapping logic stays unit-testable without the dependency).

Usage inside an agent's ``on_prompt``::

    from langchain_openai import ChatOpenAI
    from llmtoolforge_agent import model_config
    from llmtoolforge_agent.adapters.langchain import AAPCallbackHandler

    def on_prompt(ctx):
        cfg = model_config(ctx.config)
        llm = ChatOpenAI(base_url=cfg.base_url, api_key=cfg.api_key, model=cfg.model,
                         streaming=True)
        handler = AAPCallbackHandler(ctx)
        result = llm.invoke(ctx.input, config={"callbacks": [handler]})
        handler.finalize(getattr(result, "content", str(result)))
"""

from __future__ import annotations

from typing import Any

try:  # pragma: no cover - exercised only when langchain is installed
    from langchain_core.callbacks import BaseCallbackHandler as _Base

    _HAS_LANGCHAIN = True
except Exception:  # noqa: BLE001
    _Base = object  # type: ignore[assignment,misc]
    _HAS_LANGCHAIN = False


class AAPCallbackHandler(_Base):  # type: ignore[misc,valid-type]
    """Map LangChain callbacks → AAP events, accumulating streamed text."""

    def __init__(self, ctx):
        super().__init__()
        self._ctx = ctx
        self._text = ""
        self._started = False

    # --- LLM streaming ------------------------------------------------------
    def on_llm_new_token(self, token: str, **kwargs: Any) -> None:
        if not self._started:
            self._ctx.assistant_start()
            self._started = True
        self._text += token or ""
        self._ctx.assistant_delta(token or "")

    def on_llm_error(self, error: BaseException, **kwargs: Any) -> None:
        self._ctx.error(str(error))

    def on_chain_error(self, error: BaseException, **kwargs: Any) -> None:
        self._ctx.error(str(error))

    # --- Tools --------------------------------------------------------------
    def on_tool_start(
        self, serialized: dict, input_str: str, **kwargs: Any
    ) -> None:
        run_id = kwargs.get("run_id")
        name = (serialized or {}).get("name", "tool")
        self._ctx.tool_start(
            tool_call_id=str(run_id) if run_id is not None else name,
            tool_name=name,
            args=input_str,
        )

    def on_tool_end(self, output: Any, **kwargs: Any) -> None:
        run_id = kwargs.get("run_id")
        name = kwargs.get("name", "tool")
        text = output if isinstance(output, str) else str(output)
        self._ctx.tool_end(
            tool_call_id=str(run_id) if run_id is not None else name,
            tool_name=name,
            result_text=text,
            result_json=None if isinstance(output, str) else _safe_json(output),
            is_error=False,
        )

    def on_tool_error(self, error: BaseException, **kwargs: Any) -> None:
        run_id = kwargs.get("run_id")
        name = kwargs.get("name", "tool")
        self._ctx.tool_end(
            tool_call_id=str(run_id) if run_id is not None else name,
            tool_name=name,
            result_text=str(error),
            is_error=True,
        )

    # --- Finalization -------------------------------------------------------
    def finalize(self, final_text: str = "") -> None:
        """Emit ``assistant_end`` with the final text (or the accumulated stream)."""
        self._ctx.assistant_end(final_text or self._text)


def _safe_json(value: Any) -> Any:
    try:
        import json

        json.dumps(value)
        return value
    except Exception:  # noqa: BLE001
        return None


_JSON_TO_PY = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "object": dict,
    "array": list,
}


def host_tools_for_langchain(ctx) -> list:
    """Build LangChain ``StructuredTool`` objects from ``ctx.host_tools``.

    Each tool bridges to :meth:`TurnContext.call_host_tool`, so a LangGraph /
    LangChain agent's LLM can call app tools (bash/fs/grep/web_fetch/MCP/skills)
    and every call runs through the host's sandbox + approval. Requires
    ``langchain_core`` and ``pydantic`` (present wherever LangChain runs).

    Usage::

        from langgraph.prebuilt import create_react_agent
        tools = host_tools_for_langchain(ctx)
        agent = create_react_agent(llm, tools)
    """
    from langchain_core.tools import StructuredTool
    from pydantic import create_model

    tools = []
    for spec in getattr(ctx, "host_tools", []) or []:
        name = spec.get("name")
        if not name:
            continue
        schema = spec.get("parameters") or {}
        props = schema.get("properties", {}) if isinstance(schema, dict) else {}
        required = set(schema.get("required", []) if isinstance(schema, dict) else [])
        fields = {}
        for field, meta in props.items():
            py_type = _JSON_TO_PY.get((meta or {}).get("type"), Any)
            default = ... if field in required else None
            fields[field] = (py_type, default)
        args_model = create_model(f"{name}_Args", **fields) if fields else None

        def _make(tool_name: str):
            def _call(**kwargs: Any) -> str:
                res = ctx.call_host_tool(tool_name, kwargs)
                if res.get("isError"):
                    raise RuntimeError(res.get("resultText") or f"{tool_name} failed")
                return res.get("resultText", "")

            return _call

        tools.append(
            StructuredTool.from_function(
                func=_make(name),
                name=name,
                description=spec.get("description", name),
                args_schema=args_model,
            )
        )
    return tools
