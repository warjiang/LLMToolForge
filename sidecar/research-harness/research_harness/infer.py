from __future__ import annotations

from collections import Counter
import re
from typing import Any


NOISE_TERMS = [
    "恢复聊天记录",
    "聊天记录恢复",
    "删除的聊天记录",
    "聊天记录证据",
    "整理成证据",
    "起诉",
    "暴饮暴食",
    "戒手机",
]

DIMENSION_RULES = [
    ("privacy_compliance", ["隐私", "合规", "封号", "爬取", "读取", "客户信息", "授权", "本地", "privacy", "security", "compliance", "permission", "local"]),
    ("stability_performance", ["不能用", "打不开", "崩", "损坏", "deprecated", "失败", "闪退", "卡", "crash", "broken", "failed", "error", "sync", "login", "slow"]),
    ("usability_interaction", ["怎么设置", "怎么搭建", "教程", "找不到", "太麻烦", "摩擦", "步骤", "how do i", "setup", "workflow", "confusing", "manual", "hard to"]),
    ("pricing_payment", ["买了", "付费", "收费", "退款", "订阅", "会员", "价格", "paid", "subscription", "refund", "pricing", "expensive", "charged", "cancel"]),
    ("accuracy_quality", ["不准", "识别", "抓重点", "重点", "准确", "转写", "accurate", "accuracy", "transcription", "summary", "summarize", "hallucinate", "wrong"]),
    ("cross_platform", ["微信", "企业微信", "钉钉", "飞书", "qq", "跨平台", "slack", "teams", "gmail", "todoist", "notion", "zapier", "calendar"]),
    ("missing_feature", ["求", "有没有", "需要", "提醒", "待办", "日报", "总结", "会议纪要", "wish", "need", "looking for", "is there", "todo", "task", "reminder", "action item"]),
]

PERSONA_RULES = [
    ("sales_bd", ["客户", "报价", "样品", "发货", "合作机会", "销售", "bd", "sales", "customer", "client", "lead", "follow up", "crm"]),
    ("community_operator", ["群", "团长", "社群", "接龙", "群消息", "微信群", "community", "group", "slack channel", "discord"]),
    ("knowledge_worker", ["会议", "纪要", "老板", "工作", "项目", "任务", "行业群", "meeting", "notes", "project", "manager", "team", "work"]),
    ("personal_productivity", ["自律", "懒人", "记性", "提醒", "个人", "记录", "adhd", "personal", "habit", "routine", "remember"]),
]

SIGNAL_RULES = [
    ("paid_or_churn", ["买了", "付费", "收费", "会员", "退款", "不续费", "订阅", "扣费", "pro", "充了钱"]),
    ("manual_workaround", ["单人群", "置顶", "手动", "自己做", "搭建", "配置", "用 ai", "文心一言", "manual", "spreadsheet", "zapier", "notion", "calendar", "workaround"]),
    ("strong_complaint", ["崩溃", "想吐", "疯", "折磨", "要命", "烦", "看不过来", "frustrated", "overwhelmed", "annoying", "sucks", "hate", "pain", "buried"]),
    ("solution_seeking", ["求教程", "求分享", "求 skill", "求skill", "怎么设置", "怎么搭建", "有没有", "is there", "looking for", "recommend", "any app", "any tool"]),
]

VALIDATION_TARGET_RULES = [
    ("真实工作/生活场景", ["客户", "报价", "样品", "发货", "会议", "领导", "工作", "群消息", "日报", "团队", "项目", "自律", "记性", "提醒", "meeting", "client", "customer", "slack", "project", "task", "follow up"]),
    ("情绪强度", ["崩溃", "想吐", "折磨", "疯", "恼火", "烦", "看不过来", "急需", "要命", "太麻烦", "frustrated", "overwhelmed", "annoying", "sucks", "hate", "pain"]),
    ("已有凑合方案", ["单人群", "置顶", "关键词提醒", "ai", "skill", "wechat-cli", "workbuddy", "龙虾", "agent", "提醒", "app", "小程序", "notion", "todoist", "zapier", "calendar", "fireflies", "otter"]),
    ("场景词/投放词", ["微信待办", "群消息", "聊天记录", "会议纪要", "微信群日报", "待办", "漏看", "slack", "meeting notes", "action items", "follow up", "tasks"]),
]

PLATFORM_LABELS = {
    "wechat": "微信",
    "wecom": "企业微信",
    "feishu_lark": "飞书/Lark",
    "dingtalk": "钉钉",
    "slack": "Slack",
    "teams": "Microsoft Teams",
    "discord": "Discord",
    "qq": "QQ/QQ群",
    "telegram": "Telegram",
    "whatsapp": "WhatsApp",
    "unknown": "未知",
}

PLATFORM_PRIORITY = [
    "wecom",
    "wechat",
    "feishu_lark",
    "dingtalk",
    "slack",
    "teams",
    "discord",
    "qq",
    "telegram",
    "whatsapp",
]

PLATFORM_TERMS = {
    "wecom": ["企业微信", "企微", "wecom"],
    "wechat": ["微信", "微信群", "wechat", "wechat-cli", "weixin"],
    "feishu_lark": ["飞书", "飞书妙记", "lark"],
    "dingtalk": ["钉钉", "dingtalk"],
    "slack": ["slack"],
    "teams": ["microsoft teams", "ms teams", "teams to planner", "microsoft to do teams", "teams meeting", "teams channel", "teams messages"],
    "discord": ["discord"],
    "qq": ["qq群", "qq 群", "qq频道", "qq 频道", "qq机器人", "qq 机器人", "qq消息", "qq 消息"],
    "telegram": ["telegram"],
    "whatsapp": ["whatsapp"],
}

PLATFORM_CONTEXT_SCORES = {
    "query": 95,
    "title": 92,
    "metrics": 90,
    "body": 88,
    "comments": 84,
    "source_url": 82,
}


def _metrics_text(record: dict[str, Any]) -> str:
    metrics = record.get("metrics") or {}
    if not isinstance(metrics, dict):
        return ""
    useful_keys = [
        "app_name",
        "app_id",
        "package",
        "bundle_id",
        "subreddit",
        "store_name",
        "market_segment",
        "query_subreddit",
        "source_type",
    ]
    return " ".join(str(metrics.get(key, "")) for key in useful_keys)


def _extra_text(record: dict[str, Any]) -> str:
    extra = record.get("extra") or {}
    if not isinstance(extra, dict):
        return ""
    useful_keys = ["author", "domain", "url", "search_url"]
    return " ".join(str(extra.get(key, "")) for key in useful_keys)


def _platform_contexts(record: dict[str, Any]) -> dict[str, str]:
    comments = record.get("comments") or []
    comment_text = " ".join(str(c.get("content") or c.get("c") or "") for c in comments if isinstance(c, dict))
    return {
        "query": str(record.get("query") or ""),
        "title": str(record.get("title") or ""),
        "body": str(record.get("body") or ""),
        "comments": comment_text,
        "metrics": _metrics_text(record),
        "source_url": " ".join([str(record.get("source_url") or ""), _extra_text(record)]),
    }


def _clean_platform_text(platform: str, text: str) -> str:
    if platform == "wechat":
        return text.replace("企业微信", "").replace("企微", "")
    if platform == "qq":
        return text.replace("qq邮箱", "").replace("qq 邮箱", "")
    return text


def _platform_term_hits(platform: str, text: str) -> list[str]:
    normalized = _clean_platform_text(platform, text.lower())
    hits = []
    for term in PLATFORM_TERMS.get(platform, []):
        if has_term(normalized, term.lower()):
            hits.append(term)
    return hits


def _platform_candidates(record: dict[str, Any]) -> dict[str, dict[str, Any]]:
    candidates: dict[str, dict[str, Any]] = {}
    for context_name, value in _platform_contexts(record).items():
        if not value:
            continue
        for platform in PLATFORM_PRIORITY:
            hits = _platform_term_hits(platform, value)
            if not hits:
                continue
            score = PLATFORM_CONTEXT_SCORES[context_name]
            current = candidates.get(platform)
            reason = f"{context_name}: {', '.join(hits[:3])}"
            if not current or score > int(current["score"]):
                candidates[platform] = {"score": score, "reason": reason}
    return candidates


def infer_platform(record: dict[str, Any]) -> dict[str, Any]:
    candidates = _platform_candidates(record)
    if not candidates:
        return {
            "primary_platform": "unknown",
            "platform_confidence": "unknown",
            "platform_confidence_score": 0,
            "platform_reason": "未命中明确平台词，且没有 80% 以上可靠的平台上下文。",
            "secondary_platforms": [],
        }
    ordered = sorted(
        candidates.items(),
        key=lambda item: (-int(item[1]["score"]), PLATFORM_PRIORITY.index(item[0]) if item[0] in PLATFORM_PRIORITY else 99),
    )
    primary, payload = ordered[0]
    score = int(payload["score"])
    if score < 80:
        return {
            "primary_platform": "unknown",
            "platform_confidence": "unknown",
            "platform_confidence_score": score,
            "platform_reason": "平台命中低于 80% 可靠性阈值。",
            "secondary_platforms": [platform for platform, data in ordered if int(data["score"]) >= 80],
        }
    return {
        "primary_platform": primary,
        "platform_confidence": "explicit" if score >= 90 else "inferred_high",
        "platform_confidence_score": score,
        "platform_reason": str(payload["reason"]),
        "secondary_platforms": [platform for platform, data in ordered[1:] if int(data["score"]) >= 80],
    }


def joined_text(record: dict[str, Any]) -> str:
    comments = record.get("comments") or []
    comment_text = " ".join(str(c.get("content") or c.get("c") or "") for c in comments if isinstance(c, dict))
    return " ".join(
        str(record.get(key, ""))
        for key in ["title", "body", "query", "record_type"]
    ) + " " + comment_text


def _is_search_result_only(record: dict[str, Any]) -> bool:
    extra = record.get("extra") or {}
    if isinstance(extra, dict) and extra.get("search_result_only"):
        return True
    metrics = record.get("metrics") or {}
    return isinstance(metrics, dict) and bool(metrics.get("search_result_only"))


def has_term(text: str, term: str) -> bool:
    lowered = term.lower()
    if lowered.isascii() and any(ch.isalnum() for ch in lowered):
        return re.search(rf"(?<![a-z0-9]){re.escape(lowered)}(?![a-z0-9])", text) is not None
    return lowered in text


def is_noise(record: dict[str, Any]) -> bool:
    text = joined_text(record).lower()
    return any(has_term(text, term) for term in NOISE_TERMS)


def infer_dimension(record: dict[str, Any]) -> str:
    if is_noise(record):
        return "noise"
    text = joined_text(record).lower()
    for dimension, terms in DIMENSION_RULES:
        if any(has_term(text, term) for term in terms):
            return dimension
    return "missing_feature"


def infer_persona(record: dict[str, Any]) -> str:
    text = joined_text(record).lower()
    for persona, terms in PERSONA_RULES:
        if any(has_term(text, term) for term in terms):
            return persona
    return "unknown"


def infer_signal_strength(record: dict[str, Any]) -> str:
    text = joined_text(record).lower()
    for signal, terms in SIGNAL_RULES:
        if any(has_term(text, term) for term in terms):
            return signal
    if record.get("record_type") == "review":
        try:
            rating = int((record.get("metrics") or {}).get("rating") or 0)
        except (TypeError, ValueError):
            rating = 0
        if rating and rating <= 2:
            return "strong_complaint"
    if record.get("body"):
        return "weak_complaint"
    return "title_level"


def infer_confidence(record: dict[str, Any]) -> str:
    if is_noise(record):
        return "N"
    has_url = bool(record.get("source_url"))
    has_body = bool(record.get("body"))
    has_title = bool(record.get("title"))
    if _is_search_result_only(record):
        return "B" if has_url and (has_body or has_title) else "C"
    has_comments = bool(record.get("comments"))
    has_comment_id = bool(record.get("comment_id") or record.get("commentId"))
    metrics = record.get("metrics") or {}
    has_metrics = any(v not in ("", None, 0, "0") for v in metrics.values())
    if record.get("record_type") == "comment" and has_url and has_body and has_comment_id:
        return "A"
    if record.get("record_type") in {"comment", "reply"} and has_url and has_body:
        return "B"
    if has_url and has_body and (has_comments or has_metrics):
        return "A"
    if has_url and (has_body or has_title):
        return "B"
    return "C"


def infer_source_quality(record: dict[str, Any]) -> str:
    record_type = str(record.get("record_type") or "post")
    if _is_search_result_only(record):
        return "search_snippet"
    if record_type in {"metric", "search_index"}:
        return "metric_only"
    if record_type in {"comment", "reply"} and record.get("body"):
        return "comment"
    if record.get("body"):
        return "full_text"
    if record.get("title"):
        return "title_only"
    return "unknown"


def infer_evidence_role(record: dict[str, Any]) -> str:
    if is_noise(record):
        return "noise"
    if record.get("record_type") == "review":
        return "competitor"
    text = joined_text(record).lower()
    if any(has_term(text, term) for term in ["竞品", "替代", "聊记", "龙虾", "元宝", "todoist", "ticktick", "otter", "fireflies"]):
        return "competitor"
    return "support"


def infer_validation_targets(record: dict[str, Any]) -> list[str]:
    text = joined_text(record).lower()
    targets = [
        target
        for target, terms in VALIDATION_TARGET_RULES
        if any(has_term(text, term) for term in terms)
    ]
    return targets or ["待人工判断"]


def infer_interpretation(record: dict[str, Any]) -> str:
    if is_noise(record):
        return "噪声/反向线索：该条可能偏离当前待办提取场景。"
    dimension = infer_dimension(record)
    signal = infer_signal_strength(record)
    return f"支持「{dimension}」维度，信号强度为「{signal}」。"


def infer_next_step(record: dict[str, Any]) -> str:
    confidence = infer_confidence(record)
    if confidence in {"C", "B"} and not record.get("body"):
        return "补抓正文/评论，确认是否为真实用户表达。"
    if infer_evidence_role(record) == "noise":
        return "保留为噪声词/避坑词，避免用于正向规模判断。"
    if "付费" in joined_text(record) or "买了" in joined_text(record):
        return "补访谈或二级回复，确认可接受价格和替代方案。"
    return "纳入渠道结论，必要时补同类样本。"


def summarize_comments(comments: list[dict[str, Any]], limit: int = 5) -> str:
    if not comments:
        return ""
    snippets = []
    buckets = Counter()
    for comment in comments:
        content = str(comment.get("content") or comment.get("c") or "").strip()
        if not content:
            continue
        fake_record = {"title": "", "body": content, "comments": []}
        buckets[infer_signal_strength(fake_record)] += 1
        like = str(comment.get("like", ""))
        suffix = f"({like}赞)" if like and like != "0" else ""
        snippets.append((content, suffix))
    head = "；".join(f"「{text[:48]}」{suffix}" for text, suffix in snippets[:limit])
    if buckets:
        signal_counts = ", ".join(f"{k}:{v}" for k, v in buckets.most_common())
        return f"{head}。评论信号: {signal_counts}"
    return head
