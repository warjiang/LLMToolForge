"""Python SDK offline tests: AAP runtime loop + LangChain handler mapping.

Run:  python platform/python/tests/test_runtime.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG_ROOT = HERE.parent
MARKER = "@@AAP@@"


def _parse_events(text: str) -> list:
    events = []
    for line in text.splitlines():
        line = line.strip()
        if line.startswith(MARKER):
            events.append(json.loads(line[len(MARKER):]))
    return events


def test_runtime_loop() -> None:
    """Drive a canned agent subprocess through a full turn."""
    agent = HERE / "fixtures" / "canned_agent.py"
    env = dict(os.environ)
    env["PYTHONPATH"] = str(PKG_ROOT) + os.pathsep + env.get("PYTHONPATH", "")
    proc = subprocess.Popen(
        [sys.executable, str(agent)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        text=True,
        env=env,
    )
    init = {
        "type": "init",
        "protocolVersion": 1,
        "config": {"baseUrl": "x", "localKey": "y", "model": "m",
                   "systemPrompt": "", "temperature": 0.7, "maxTokens": 100},
        "history": [],
    }
    assert proc.stdin is not None
    payload = json.dumps(init) + "\n" + json.dumps({"type": "prompt", "input": "hi"}) + "\n"
    out, _ = proc.communicate(input=payload, timeout=10)

    events = _parse_events(out)
    types = [e["type"] for e in events]
    assert "ready" in types, types
    assert "assistant_start" in types, types
    assert "assistant_delta" in types, types
    assert types[-1] == "done", types
    acc = "".join(e["delta"] for e in events if e["type"] == "assistant_delta")
    assert acc == "hello from canned agent", acc
    print("PASS: runtime loop")


def test_langchain_handler() -> None:
    """The LangChain callback handler maps tokens/tools to AAP events."""
    sys.path.insert(0, str(PKG_ROOT))
    from llmtoolforge_agent.runtime import TurnContext
    from llmtoolforge_agent.adapters.langchain import AAPCallbackHandler

    emitted = []
    ctx = TurnContext(input="q", config={}, history=[])
    # Capture emits by monkeypatching the module-level _emit.
    import llmtoolforge_agent.runtime as rt

    orig = rt._emit
    rt._emit = lambda e: emitted.append(e)
    try:
        handler = AAPCallbackHandler(ctx)
        handler.on_llm_new_token("Hello")
        handler.on_llm_new_token(" world")
        handler.on_tool_start({"name": "search"}, "query", run_id="r1")
        handler.on_tool_end({"hits": 3}, run_id="r1", name="search")
        handler.finalize()
    finally:
        rt._emit = orig

    types = [e["type"] for e in emitted]
    assert "assistant_start" in types, types
    assert "tool_start" in types, types
    assert "tool_end" in types, types
    end = next(e for e in emitted if e["type"] == "assistant_end")
    assert end["text"] == "Hello world", end
    tool_end = next(e for e in emitted if e["type"] == "tool_end")
    assert tool_end["resultJson"] == {"hits": 3}, tool_end
    print("PASS: langchain handler mapping")


if __name__ == "__main__":
    test_runtime_loop()
    test_langchain_handler()
    print("ALL PYTHON SDK TESTS PASSED")
