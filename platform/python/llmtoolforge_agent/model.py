"""Model config helper for Python agents.

The host injects the Unified gateway coordinates via environment variables and
also provides them in the ``init`` message's ``config``. This returns them in a
shape convenient for OpenAI-compatible clients.
"""

from __future__ import annotations

import os
from typing import Optional


class ModelConfig:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        user_agent: str = "",
    ):
        self.base_url = base_url
        self.api_key = api_key
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.user_agent = user_agent
        # Spread into an OpenAI-compatible client (e.g.
        # ``ChatOpenAI(default_headers=cfg.headers)``) so the app's call monitor
        # can attribute Unified requests to this agent.
        self.headers = {"User-Agent": user_agent} if user_agent else {}


def _num(value: Optional[str]) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def model_config(config: Optional[dict]) -> ModelConfig:
    config = config or {}
    temperature = config.get("temperature")
    if temperature is None:
        temperature = _num(os.environ.get("UNIFIED_TEMPERATURE"))
    max_tokens = config.get("maxTokens")
    if max_tokens is None:
        raw = _num(os.environ.get("UNIFIED_MAX_TOKENS"))
        max_tokens = int(raw) if raw is not None else None
    return ModelConfig(
        base_url=config.get("baseUrl") or os.environ.get("UNIFIED_BASE_URL", ""),
        api_key=config.get("localKey") or os.environ.get("UNIFIED_API_KEY", ""),
        model=config.get("model") or os.environ.get("UNIFIED_MODEL", ""),
        temperature=temperature,
        max_tokens=max_tokens,
        user_agent=config.get("userAgent") or os.environ.get("UNIFIED_USER_AGENT", ""),
    )
