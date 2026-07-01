"""Model config helper for Python agents.

The host injects the Unified gateway coordinates via environment variables and
also provides them in the ``init`` message's ``config``. This returns them in a
shape convenient for OpenAI-compatible clients.
"""

from __future__ import annotations

import os
from typing import Optional


class ModelConfig:
    def __init__(self, base_url: str, api_key: str, model: str):
        self.base_url = base_url
        self.api_key = api_key
        self.model = model


def model_config(config: Optional[dict]) -> ModelConfig:
    config = config or {}
    return ModelConfig(
        base_url=config.get("baseUrl") or os.environ.get("UNIFIED_BASE_URL", ""),
        api_key=config.get("localKey") or os.environ.get("UNIFIED_API_KEY", ""),
        model=config.get("model") or os.environ.get("UNIFIED_MODEL", ""),
    )
