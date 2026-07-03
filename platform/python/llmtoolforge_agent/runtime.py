"""AAP runtime for Python agents.

Handles the stdio Agent Adapter Protocol so agent authors only implement
``on_prompt``:

- a background thread reads newline-delimited JSON host messages
  (``init`` / ``prompt`` / ``abort``) so ``abort`` can flip a cooperative flag
  mid-stream;
- the main thread runs one :class:`TurnContext` per prompt (sync or async
  ``on_prompt``), auto-emitting ``done``;
- events are serialized to stdout with the ``@@AAP@@`` marker.

See ``../../../src/lib/agent/aap/PROTOCOL.md`` for the wire contract.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import queue
import sys
import threading
import traceback
from typing import Any, Awaitable, Callable, Optional, Protocol, Union

AAP_MARKER = "@@AAP@@"
AAP_PROTOCOL_VERSION = 1

_write_lock = threading.Lock()


def _emit(event: dict) -> None:
    line = AAP_MARKER + json.dumps(event, ensure_ascii=False)
    with _write_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


class TurnContext:
    """Per-turn context handed to ``on_prompt``.

    Exposes typed emit helpers plus the prompt ``input``, the init ``config`` /
    ``history``, and a cooperative ``aborted`` flag (set when the host sends
    ``abort``).
    """

    def __init__(
        self,
        *,
        input: str,
        config: Optional[dict],
        history: list,
        host_tools: Optional[list] = None,
        call_host: Optional[Callable[[str, Any], dict]] = None,
    ):
        self.input = input
        self.config = config or {}
        self.history = history or []
        #: Host tool specs advertised in ``init`` ({name, description, parameters}).
        self.host_tools = host_tools or []
        self._call_host = call_host
        self.aborted = False
        self._started = False
        self._ended = False

    def call_host_tool(self, tool_name: str, args: Any = None) -> dict:
        """Invoke a host tool (bash/fs/grep/web_fetch/MCP/skills) and block for
        its result. Runs through the host's sandbox + approval gating. Returns
        ``{"resultText": str, "resultJson": Any, "isError": bool}``.
        """
        if self._call_host is None:
            raise RuntimeError("host tools unavailable in this context")
        return self._call_host(tool_name, args if args is not None else {})

    def assistant_start(self) -> None:
        self._started = True
        _emit({"type": "assistant_start"})

    def assistant_delta(self, delta: str) -> None:
        if not self._started:
            self.assistant_start()
        if delta:
            _emit({"type": "assistant_delta", "delta": delta})

    def reasoning_delta(self, delta: str) -> None:
        if delta:
            _emit({"type": "reasoning_delta", "delta": delta})

    def assistant_end(self, text: str = "") -> None:
        self._ended = True
        _emit({"type": "assistant_end", "text": text})

    def tool_start(self, *, tool_call_id: str, tool_name: str, args: Any = None) -> None:
        _emit(
            {
                "type": "tool_start",
                "toolCallId": tool_call_id,
                "toolName": tool_name,
                "args": args,
            }
        )

    def tool_end(
        self,
        *,
        tool_call_id: str,
        tool_name: str,
        result_text: str = "",
        result_json: Any = None,
        is_error: bool = False,
    ) -> None:
        _emit(
            {
                "type": "tool_end",
                "toolCallId": tool_call_id,
                "toolName": tool_name,
                "resultText": result_text,
                "resultJson": result_json,
                "isError": is_error,
            }
        )

    def error(self, message: str) -> None:
        _emit({"type": "error", "message": str(message)})


PromptHandler = Callable[[TurnContext], Union[None, Awaitable[None]]]


class Agent(Protocol):
    def on_prompt(self, ctx: TurnContext) -> Union[None, Awaitable[None]]: ...


def _run_handler(handler: PromptHandler, ctx: TurnContext) -> None:
    try:
        result = handler(ctx)
        if inspect.isawaitable(result):
            asyncio.run(result)  # type: ignore[arg-type]
        if ctx._started and not ctx._ended:
            ctx.assistant_end("")
    except Exception:  # noqa: BLE001 - surface any failure as an AAP error
        ctx.error(traceback.format_exc())
    finally:
        _emit({"type": "done"})


def run(
    on_prompt: PromptHandler,
    *,
    name: str = "python-agent",
    on_init: Optional[Callable[[dict, list], None]] = None,
) -> None:
    """Start the AAP read/dispatch loop.

    ``on_prompt`` may be a regular or ``async`` function. ``on_init`` (optional)
    is called once with ``(config, history)`` on the ``init`` message.
    """

    _emit({"type": "ready", "protocolVersion": AAP_PROTOCOL_VERSION, "agent": name})

    prompts: "queue.Queue[Optional[str]]" = queue.Queue()
    state: dict = {"config": None, "history": [], "host_tools": [], "ctx": None}

    # Correlated host tool calls: callId -> {"event": Event, "result": dict}.
    host_calls: dict = {}
    host_calls_lock = threading.Lock()
    host_seq = {"n": 0}

    def call_host(tool_name: str, args: Any) -> dict:
        with host_calls_lock:
            host_seq["n"] += 1
            call_id = f"p{host_seq['n']}"
            slot = {"event": threading.Event(), "result": None}
            host_calls[call_id] = slot
        _emit(
            {
                "type": "host_tool_call",
                "callId": call_id,
                "toolName": tool_name,
                "args": args,
            }
        )
        ctx = state.get("ctx")
        # Wait for the reader thread to deliver the result, staying responsive to
        # a cooperative abort so a denied/slow tool can't wedge the turn.
        while not slot["event"].wait(timeout=0.1):
            if ctx is not None and getattr(ctx, "aborted", False):
                with host_calls_lock:
                    host_calls.pop(call_id, None)
                return {
                    "resultText": "aborted",
                    "resultJson": None,
                    "isError": True,
                }
        return slot["result"] or {
            "resultText": "",
            "resultJson": None,
            "isError": True,
        }

    def reader() -> None:
        for raw in sys.stdin:
            line = raw.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                print(f"agent-sdk: bad json line: {line}", file=sys.stderr)
                continue
            mtype = msg.get("type")
            if mtype == "init":
                state["config"] = msg.get("config")
                state["history"] = msg.get("history", [])
                state["host_tools"] = msg.get("hostTools", [])
                if on_init is not None:
                    try:
                        on_init(state["config"], state["history"])
                    except Exception:  # noqa: BLE001
                        traceback.print_exc()
            elif mtype == "prompt":
                prompts.put(msg.get("input", ""))
            elif mtype == "abort":
                ctx = state.get("ctx")
                if ctx is not None:
                    ctx.aborted = True
            elif mtype == "host_tool_result":
                call_id = msg.get("callId")
                with host_calls_lock:
                    slot = host_calls.pop(call_id, None)
                if slot is not None:
                    slot["result"] = {
                        "resultText": msg.get("resultText", ""),
                        "resultJson": msg.get("resultJson"),
                        "isError": bool(msg.get("isError")),
                    }
                    slot["event"].set()
        prompts.put(None)  # sentinel: stdin closed

    threading.Thread(target=reader, daemon=True).start()

    while True:
        item = prompts.get()
        if item is None:
            break
        ctx = TurnContext(
            input=item,
            config=state["config"],
            history=state["history"],
            host_tools=state["host_tools"],
            call_host=call_host,
        )
        state["ctx"] = ctx
        _run_handler(on_prompt, ctx)
        state["ctx"] = None
        # Fail any host calls left dangling so a later turn can't inherit them.
        with host_calls_lock:
            for slot in host_calls.values():
                slot["result"] = {
                    "resultText": "turn ended",
                    "resultJson": None,
                    "isError": True,
                }
                slot["event"].set()
            host_calls.clear()
