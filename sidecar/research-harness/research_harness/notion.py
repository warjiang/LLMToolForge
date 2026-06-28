from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path


def resolve_notion_token(explicit: str | None = None) -> str:
    if explicit:
        return explicit
    if os.environ.get("NOTION_TOKEN"):
        return os.environ["NOTION_TOKEN"]
    key_path = Path("/Users/meiji/.config/meiji/key.json")
    if key_path.exists():
        data = json.loads(key_path.read_text(encoding="utf-8"))
        token = (data.get("notion_cli") or {}).get("token") or (data.get("notion") or {}).get("token")
        if token:
            return token
    raise RuntimeError("No Notion token found. Pass --token or set NOTION_TOKEN.")


def _rich(text: str) -> list[dict]:
    return [{"type": "text", "text": {"content": text[:1900]}}]


def markdown_to_blocks(markdown: str) -> list[dict]:
    blocks: list[dict] = []
    for raw_line in markdown.splitlines():
        line = raw_line.rstrip()
        if not line:
            continue
        if line.startswith("# "):
            blocks.append({"object": "block", "type": "heading_1", "heading_1": {"rich_text": _rich(line[2:])}})
        elif line.startswith("## "):
            blocks.append({"object": "block", "type": "heading_2", "heading_2": {"rich_text": _rich(line[3:])}})
        elif line.startswith("### "):
            blocks.append({"object": "block", "type": "heading_3", "heading_3": {"rich_text": _rich(line[4:])}})
        elif line.startswith("- "):
            blocks.append({"object": "block", "type": "bulleted_list_item", "bulleted_list_item": {"rich_text": _rich(line[2:])}})
        elif line.startswith("|"):
            # Keep markdown tables compact and Git-friendly in Notion.
            blocks.append({"object": "block", "type": "paragraph", "paragraph": {"rich_text": _rich(line)}})
        else:
            blocks.append({"object": "block", "type": "paragraph", "paragraph": {"rich_text": _rich(line)}})
    return blocks


def append_blocks(page_id: str, blocks: list[dict], token: str) -> None:
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
    }
    for idx in range(0, len(blocks), 80):
        body = json.dumps({"children": blocks[idx : idx + 80]}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            f"https://api.notion.com/v1/blocks/{page_id}/children",
            data=body,
            method="PATCH",
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp.read()


def publish_markdown(page_id: str, markdown_path: Path, token: str | None = None, dry_run: bool = False) -> int:
    markdown = markdown_path.read_text(encoding="utf-8")
    blocks = markdown_to_blocks(markdown)
    if dry_run:
        return len(blocks)
    append_blocks(page_id, blocks, resolve_notion_token(token))
    return len(blocks)

