from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
import re

from .approval import require_keyword_approval
from .delta import latest_delta_reports
from .infer import PLATFORM_LABELS
from .storage import read_json, read_jsonl


VALIDATION_BUCKETS = {
    "real_work_scene": ["客户", "报价", "样品", "发货", "会议", "领导", "工作", "群消息", "日报", "团队", "项目", "业务", "meeting", "client", "customer", "sales", "project", "team", "slack", "task", "follow up"],
    "real_life_scene": ["自律", "记性", "提醒", "懒人", "个人", "习惯", "日程", "adhd", "personal", "habit", "routine", "remember"],
    "strong_emotion": ["崩溃", "想吐", "折磨", "疯", "恼火", "烦", "看不过来", "急需", "要命", "frustrated", "overwhelmed", "annoying", "sucks", "hate", "pain", "buried"],
    "wechat_workaround": ["微信", "企业微信", "飞书", "钉钉", "群", "单人群", "置顶", "关键词提醒", "群聊", "头像", "群名", "slack", "microsoft teams", "teams channel", "discord", "lark", "dingtalk", "channel"],
    "ai_workaround": ["ai", "skill", "wechat-cli", "workbuddy", "龙虾", "agent", "文心", "openclaw", "fireflies", "otter", "reclaim", "motion"],
    "todo_tool_workaround": ["待办", "提醒", "app", "小程序", "滴答", "定时", "todoist", "notion", "zapier", "calendar", "reminder", "task"],
    "privacy_risk": ["封号", "隐私", "合规", "爬取", "读取", "客户信息", "pc", "privacy", "security", "permission", "compliance"],
}

CHANNEL_LABELS = {
    "xiaohongshu": "小红书",
    "v2ex": "V2EX",
    "appstore": "应用市场评论",
    "wechat-ecosystem": "微信生态",
    "reddit": "Reddit",
    "zhihu": "知乎",
    "weibo": "微博",
    "jike": "即刻",
    "baidu-suggest": "百度下拉长尾词",
    "baidu-index": "百度指数",
    "google-trends": "Google Trends",
    "5118-index": "5118指数",
    "oceanengine-index": "巨量算数",
    "douyin-index": "抖音指数",
    "wechat-index": "微信指数",
    "google-play": "Google Play",
    "github": "GitHub/开源",
    "competitors": "竞品官网/定价",
}

RECORD_TYPE_LABELS = {
    "post": "社区原帖/主贴",
    "question": "问答问题",
    "answer": "问答回答",
    "article": "文章",
    "comment": "社区评论/楼中评论",
    "reply": "社区回复",
    "review": "应用市场评价",
    "metric": "评分/指数指标",
    "competitor": "竞品",
    "search_result": "搜索结果",
    "tool": "小程序/工具线索",
    "weak_signal": "弱信号",
    "unknown": "未知",
}

PAIN_DIMENSION_LABELS = {
    "accuracy_quality": "准确率/质量",
    "privacy_compliance": "隐私与合规",
    "cross_platform": "跨平台/打通",
    "pricing_payment": "价格/付费",
    "usability_interaction": "易用性/交互",
    "stability_performance": "稳定性/性能",
    "missing_feature": "缺失功能",
    "noise": "噪音/不相关",
}

SIGNAL_LABELS = {
    "paid_or_churn": "已付费/流失",
    "manual_workaround": "已手动凑合",
    "strong_complaint": "强情绪抱怨",
    "solution_seeking": "明确求解",
    "weak_complaint": "弱抱怨/一般反馈",
    "title_level": "标题级线索",
}

PLATFORM_CONFIDENCE_LABELS = {
    "explicit": "明确命中",
    "inferred_high": "高置信推断",
    "unknown": "未知",
}

CONFIDENCE_LABELS = {
    "A": "A 级",
    "B": "B 级",
    "C": "C 级",
    "N": "噪音/反证",
}

METRIC_LABELS = {
    "like": "点赞",
    "sub_comment_count": "子评论",
    "comments_fetched": "已抓评论",
    "comment_pages": "评论页数",
}

SOURCE_QUALITY_LABELS = {
    "full_text": "正文级",
    "comment": "评论级",
    "title_only": "标题级",
    "search_snippet": "搜索摘要级",
    "metric_only": "指标级",
    "unknown": "未知",
}

EVIDENCE_ROLE_LABELS = {
    "support": "支持线索",
    "counter": "反证线索",
    "noise": "噪声/避坑",
    "competitor": "竞品/替代",
    "gap": "缺口",
}

PERSONA_LABELS = {
    "knowledge_worker": "个人知识工作者",
    "sales_bd": "销售/BD/客户成功",
    "community_operator": "社群/运营",
    "personal_productivity": "个人效率用户",
    "unknown": "未知",
}

SIGNAL_RANK = {
    "paid_or_churn": 0,
    "manual_workaround": 1,
    "strong_complaint": 2,
    "solution_seeking": 3,
    "weak_complaint": 4,
    "title_level": 5,
}

SCENE_RULES = [
    ("会议纪要 → 行动项", ["会议纪要", "会议", "纪要", "行动项", "meeting notes", "meeting", "action item", "transcript"]),
    ("聊天/群消息 → 今日待处理", ["微信", "企业微信", "飞书", "钉钉", "群消息", "今日", "待处理", "客户", "报价", "发货", "slack", "microsoft teams", "lark", "dingtalk", "messages", "chat", "follow up"]),
    ("多群消息 → 每日重点日报", ["群消息", "日报", "999", "行业群", "多群", "too many messages", "message overload", "channel"]),
    ("销售/客户跟进", ["客户", "报价", "样品", "发货", "销售", "bd", "跟进", "sales", "customer", "client", "lead", "crm"]),
    ("个人提醒/待办管理", ["待办", "提醒", "记性", "自律", "日程", "todo", "task", "reminder", "adhd", "remember"]),
]

HYPOTHESIS_TERMS = ["群消息", "派活", "忘记", "过载", "会议纪要", "行动项", "付费", "本地", "授权", "隐私", "封号", "风险", "企业微信", "飞书", "钉钉", "slack", "teams"]

SEARCH_INDEX_CHANNELS = {
    "baidu-index",
    "google-trends",
    "5118-index",
    "oceanengine-index",
    "douyin-index",
    "wechat-index",
}

PLATFORM_FEASIBILITY_SCORES = {
    "slack": 20,
    "teams": 18,
    "feishu_lark": 18,
    "wecom": 14,
    "dingtalk": 14,
    "discord": 12,
    "qq": 10,
    "telegram": 10,
    "whatsapp": 10,
    "wechat": 8,
    "unknown": 0,
}


def _label(value: object, mapping: dict[str, str] | None = None, fallback: str = "未知") -> str:
    key = str(value or "")
    if not key:
        return fallback
    if mapping and key in mapping:
        return mapping[key]
    return key


def _channel_label(channel: object) -> str:
    return _label(channel, CHANNEL_LABELS)


def _record_type_label(record_type: object) -> str:
    return _label(record_type, RECORD_TYPE_LABELS)


def _confidence_label(confidence: object) -> str:
    return _label(confidence, CONFIDENCE_LABELS)


def _platform_label(platform: object) -> str:
    return _label(platform or "unknown", PLATFORM_LABELS)


def _platform_confidence_label(confidence: object) -> str:
    return _label(confidence or "unknown", PLATFORM_CONFIDENCE_LABELS)


def _translate_signal_terms(text: object) -> str:
    out = str(text or "")
    for key, label in SIGNAL_LABELS.items():
        out = out.replace(key, label)
    for key, label in METRIC_LABELS.items():
        out = out.replace(f"{key}=", f"{label}=")
    return out


def _read_json_if_exists(path: Path) -> dict:
    return read_json(path) if path.exists() else {}


def _row_text(row: dict) -> str:
    comment_signal = str(row.get("comment_signal", ""))
    if "。评论信号:" in comment_signal:
        comment_signal = comment_signal.split("。评论信号:", 1)[0]
    parts = [row.get("query", ""), row.get("title", ""), row.get("quote", ""), comment_signal]
    return " ".join(str(part) for part in parts).lower()


def _has_term(text: str, term: str) -> bool:
    lowered = term.lower()
    if lowered.isascii() and any(ch.isalnum() for ch in lowered):
        return re.search(rf"(?<![a-z0-9]){re.escape(lowered)}(?![a-z0-9])", text) is not None
    return lowered in text


def _bucket_counts(rows: list[dict]) -> Counter:
    counter: Counter = Counter()
    for row in rows:
        if row.get("noise"):
            continue
        text = _row_text(row)
        for bucket, terms in VALIDATION_BUCKETS.items():
            if bucket == "strong_emotion" and row.get("signal_strength") == "strong_complaint":
                counter[bucket] += 1
            elif any(_has_term(text, term) for term in terms):
                counter[bucket] += 1
    return counter


def _count_rows_matching(rows: list[dict], bucket_names: list[str]) -> int:
    count = 0
    for row in rows:
        if row.get("noise"):
            continue
        text = _row_text(row)
        matched = False
        for bucket in bucket_names:
            terms = VALIDATION_BUCKETS.get(bucket, [])
            if any(_has_term(text, term) for term in terms):
                matched = True
                break
        if matched:
            count += 1
    return count


def _non_noise_rows(rows: list[dict]) -> list[dict]:
    return [row for row in rows if not row.get("noise")]


def _platform_key(row: dict) -> str:
    return str(row.get("primary_platform") or "unknown")


def _planned_channels(scenario: dict, channel_groups: dict[str, list[dict]]) -> list[str]:
    ordered = []
    for channel in scenario.get("channels", []):
        if channel not in ordered:
            ordered.append(channel)
    for channel in sorted(channel_groups):
        if channel not in ordered:
            ordered.append(channel)
    return ordered


def _acceptance_counts(rows: list[dict]) -> dict[str, int]:
    return {
        "min_total_evidence": len(rows),
        "min_a_evidence": sum(1 for row in rows if row.get("confidence") == "A"),
        "min_b_evidence": sum(1 for row in rows if row.get("confidence") == "B"),
        "min_noise_evidence": sum(1 for row in rows if row.get("confidence") == "N" or row.get("evidence_role") == "noise"),
        "min_metric_evidence": sum(1 for row in rows if row.get("record_type") in {"metric", "search_index"}),
        "min_app_store_reviews": sum(
            1
            for row in rows
            if row.get("record_type") == "review" and row.get("channel") in {"appstore", "google-play"}
        ),
        "min_community_evidence": sum(1 for row in rows if row.get("channel") in {"xiaohongshu", "v2ex", "zhihu", "wechat-ecosystem", "weibo", "reddit", "jike"}),
        "min_competitor_evidence": sum(1 for row in rows if row.get("record_type") == "competitor" or row.get("evidence_role") == "competitor"),
    }


def _acceptance_failures_for_spec(rows: list[dict], spec: dict) -> list[str]:
    labels = {
        "min_total_evidence": "总线索不足",
        "min_a_evidence": "A 类线索不足",
        "min_b_evidence": "B 类线索不足",
        "min_noise_evidence": "噪声/反向线索不足",
        "min_metric_evidence": "指数/指标线索不足",
        "min_app_store_reviews": "应用商店评论不足",
        "min_community_evidence": "社区线索不足",
        "min_competitor_evidence": "竞品/开源/定价线索不足",
    }
    counts = _acceptance_counts(rows)
    failures = []
    for key, label in labels.items():
        if key in spec and counts.get(key, 0) < int(spec[key]):
            failures.append(f"{label}（{counts.get(key, 0)}/{spec[key]}）")
    return failures


def _decision_summary_md(rows: list[dict], acceptance: dict, planned_channels: list[str]) -> list[str]:
    non_noise = len([row for row in rows if not row.get("noise")])
    real_count = _count_rows_matching(rows, ["real_work_scene", "real_life_scene"])
    strong_count = _bucket_counts(rows)["strong_emotion"]
    paid_count = sum(1 for row in rows if row.get("signal_strength") == "paid_or_churn")
    workaround_count = sum(1 for row in rows if row.get("signal_strength") == "manual_workaround")
    privacy_count = _bucket_counts(rows)["privacy_risk"]
    overall_failures = _acceptance_failures_for_spec(rows, acceptance.get("overall", {}))
    missing_channels = max(0, len(planned_channels) - len({row.get("channel") for row in rows}))

    if real_count and (paid_count or workaround_count or strong_count):
        decision = "Conditional Go"
        reason = "需求与替代行为已有信号，但仍需补齐付费、合规和跨渠道证据后再进入完整产品投入。"
        if not overall_failures and not missing_channels and privacy_count == 0:
            decision = "Go"
            reason = "核心验收均通过，且暂无明显合规阻断信号。"
    elif rows:
        decision = "Continue Research"
        reason = "已有线索但尚不足以证明高强度痛点或替代/付费行为。"
    else:
        decision = "Not Started"
        reason = "尚未采集到标准化线索。"

    blockers = []
    blockers.extend(overall_failures[:3])
    if missing_channels:
        blockers.append(f"计划渠道仍有 {missing_channels} 个未采集")
    if privacy_count:
        blockers.append(f"合规/取数风险信号 {privacy_count} 条")
    blocker_text = "；".join(blockers) if blockers else "暂无阻断项"
    return [
        "## 决策摘要",
        "",
        "| 项目 | 当前判断 |",
        "|---|---|",
        f"| Go/No-Go | {decision} |",
        f"| 判断依据 | {_cell(reason, 220)} |",
        f"| 需求真实性 | 真实场景命中 {real_count}/{non_noise}，强情绪命中 {strong_count}/{non_noise} |",
        f"| 替代/付费信号 | 已付费/流失 {paid_count}，已手动凑合/自建 {workaround_count} |",
        f"| 最大阻断项 | {_cell(blocker_text, 260)} |",
        "",
    ]


def _decision_questions_md(rows: list[dict]) -> list[str]:
    non_noise = len([row for row in rows if not row.get("noise")])
    real_count = _count_rows_matching(rows, ["real_work_scene", "real_life_scene"])
    strong_count = _bucket_counts(rows)["strong_emotion"]
    paid_count = sum(1 for row in rows if row.get("signal_strength") == "paid_or_churn")
    workaround_count = sum(1 for row in rows if row.get("signal_strength") == "manual_workaround")
    competitor_count = sum(1 for row in rows if row.get("evidence_role") == "competitor")
    privacy_count = _bucket_counts(rows)["privacy_risk"]
    return [
        "## 三大验证问题状态",
        "",
        "| 验证问题 | 当前状态 | 线索数量 | 下一步判断口径 |",
        "|---|---|---:|---|",
        f"| 谁的待办痛点最强、最高频 | {'部分成立' if real_count else '证据不足'} | 真实场景 {real_count}/{non_noise}；强情绪 {strong_count}/{non_noise} | 用访谈确认具体损失和频率，不直接问“想不想要”。 |",
        f"| 是否愿意为此付费 | {'待付费验证' if paid_count < 5 else '有较强先例'} | 已付费/流失 {paid_count}；手动凑合 {workaround_count}；竞品/替代 {competitor_count} | 补竞品定价、应用商店差评，并用 Fake Door / 早鸟付费验证。 |",
        f"| 数据获取是否合规可行 | {'高风险待验证' if privacy_count else '待技术验证'} | 合规/取数风险 {privacy_count} | 优先验证用户授权导出、本地处理、指定群/联系人范围。 |",
        "",
    ]


def _channel_completion_md(planned_channels: list[str], channel_groups: dict[str, list[dict]], acceptance: dict) -> list[str]:
    lines = [
        "## 渠道完成矩阵",
        "",
        "| 渠道 | 线索数 | A | B | N | 完成状态 | 渠道结论文档 |",
        "|---|---:|---:|---:|---:|---|---|",
    ]
    for channel in planned_channels:
        channel_rows = channel_groups.get(channel, [])
        counts = _acceptance_counts(channel_rows)
        failures = _acceptance_failures_for_spec(channel_rows, (acceptance.get("channels") or {}).get(channel, {}))
        if not channel_rows:
            status = "未采集"
        elif failures:
            status = "未完成：" + "；".join(failures[:2])
        else:
            status = "已完成"
        link = f"[{_channel_label(channel)}](channel-{channel}.md)"
        lines.append(
            f"| {_channel_label(channel)} | {len(channel_rows)} | {counts['min_a_evidence']} | "
            f"{counts['min_b_evidence']} | {counts['min_noise_evidence']} | {_cell(status, 120)} | {link} |"
        )
    lines.append("")
    return lines


def _search_index_rollup_md(planned_channels: list[str], channel_groups: dict[str, list[dict]]) -> list[str]:
    channels = [channel for channel in planned_channels if channel in SEARCH_INDEX_CHANNELS]
    if not channels:
        return []
    lines = [
        "## 指数渠道归纳",
        "",
        "指数渠道只用于规模、触达词和内容选题校准；不直接证明真实场景、强情绪、凑合方案或付费意愿。",
        "",
        "| 渠道 | 指标线索 | 有数值指标 | 未收录/无可见指数词 | 关键观察 | 渠道结论 |",
        "|---|---:|---:|---|---|---|",
    ]
    for channel in channels:
        rows = [row for row in channel_groups.get(channel, []) if row.get("record_type") in {"metric", "search_index"} and not row.get("noise")]
        rows_with_value = [(row, _parse_metric_value(row)) for row in rows]
        rows_with_value = [(row, value) for row, value in rows_with_value if value is not None]
        no_index = _no_index_keywords(rows)
        no_index_text = "、".join(no_index[:6]) if no_index else "暂无"
        top_text = _top_metric_text(rows_with_value, limit=3)
        long_tail_text = _long_tail_summary_text(rows, limit=4)
        if not rows:
            observation = "未采集到可导入指标"
            conclusion = "暂不能用于规模判断"
        elif channel == "5118-index":
            observation = long_tail_text
            conclusion = "会议纪要泛词供给明显强；微信待办、聊天记录总结等更像长尾/低指数词。"
        elif channel in {"oceanengine-index", "douyin-index"}:
            observation = f"Top：{top_text}；未收录：{no_index_text}"
            conclusion = "字节内容生态对泛效率/待办清单有弱到中等触达，待办提取核心词多未收录。"
        else:
            observation = "未采集到可导入指标"
            conclusion = "需要修复入口/网络后重跑。"
        lines.append(
            f"| {_channel_label(channel)} | {len(rows)} | {len(rows_with_value)} | {_cell(no_index_text, 140)} | "
            f"{_cell(observation, 220)} | {_cell(conclusion, 180)} |"
        )
    lines.append("")
    return lines


def _platform_completion_md(rows: list[dict]) -> list[str]:
    platform_groups: dict[str, list[dict]] = defaultdict(list)
    for row in _non_noise_rows(rows):
        platform_groups[_platform_key(row)].append(row)
    ordered = sorted(platform_groups, key=lambda platform: (platform == "unknown", -len(platform_groups[platform]), _platform_label(platform)))
    lines = [
        "## 平台覆盖矩阵",
        "",
        "该表只统计线索数量和信号分布；具体原文见各渠道结论文档。",
        "",
        "| 平台 | 有效线索 | A | B | 强情绪 | 求解/凑合 | 已付费/流失 | 竞品/替代 | 隐私风险 | 主要渠道 |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for platform in ordered:
        platform_rows = platform_groups[platform]
        channels = Counter(row.get("channel") for row in platform_rows)
        channel_text = "、".join(f"{_channel_label(channel)} {count}" for channel, count in channels.most_common(3)) or "暂无"
        lines.append(
            f"| {_platform_label(platform)} | {len(platform_rows)} | "
            f"{sum(1 for row in platform_rows if row.get('confidence') == 'A')} | "
            f"{sum(1 for row in platform_rows if row.get('confidence') == 'B')} | "
            f"{sum(1 for row in platform_rows if row.get('signal_strength') == 'strong_complaint')} | "
            f"{sum(1 for row in platform_rows if row.get('signal_strength') in {'manual_workaround', 'solution_seeking'})} | "
            f"{sum(1 for row in platform_rows if row.get('signal_strength') == 'paid_or_churn')} | "
            f"{sum(1 for row in platform_rows if row.get('evidence_role') == 'competitor')} | "
            f"{_bucket_counts(platform_rows)['privacy_risk']} | {_cell(channel_text, 160)} |"
        )
    if not ordered:
        lines.append("| 暂无 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 暂无 |")
    lines.append("")
    return lines


def _platform_opportunity_md(rows: list[dict]) -> list[str]:
    platform_groups: dict[str, list[dict]] = defaultdict(list)
    for row in _non_noise_rows(rows):
        platform = _platform_key(row)
        if platform != "unknown":
            platform_groups[platform].append(row)
    scored = []
    for platform, platform_rows in platform_groups.items():
        real = _count_rows_matching(platform_rows, ["real_work_scene", "real_life_scene"])
        strong = sum(1 for row in platform_rows if row.get("signal_strength") == "strong_complaint")
        solution = sum(1 for row in platform_rows if row.get("signal_strength") == "solution_seeking")
        paid = sum(1 for row in platform_rows if row.get("signal_strength") == "paid_or_churn")
        manual = sum(1 for row in platform_rows if row.get("signal_strength") == "manual_workaround")
        competitor = sum(1 for row in platform_rows if row.get("evidence_role") == "competitor")
        privacy = _bucket_counts(platform_rows)["privacy_risk"]
        personas = {row.get("persona") for row in platform_rows if row.get("persona") not in ("", None, "unknown")}
        queries = {row.get("query") for row in platform_rows if row.get("query")}
        demand_score = min(25, real * 2 + strong * 3 + solution * 2)
        paid_alt_score = min(20, paid * 4 + manual * 2 + competitor * 2)
        feasibility_score = PLATFORM_FEASIBILITY_SCORES.get(platform, 8)
        persona_score = min(15, len(personas) * 2)
        keyword_score = min(10, len(queries))
        risk_penalty = min(10, privacy * 2)
        total = demand_score + paid_alt_score + feasibility_score + persona_score + keyword_score - risk_penalty
        scored.append({
            "platform": platform,
            "total": total,
            "demand": demand_score,
            "paid_alt": paid_alt_score,
            "feasibility": feasibility_score,
            "persona": persona_score,
            "keyword": keyword_score,
            "risk": risk_penalty,
            "count": len(platform_rows),
        })
    scored.sort(key=lambda item: (-int(item["total"]), -int(item["count"]), _platform_label(item["platform"])))
    lines = [
        "## 平台机会评分",
        "",
        "评分是启发式排序，用于决定下一轮补证和访谈优先级，不代表市场规模。",
        "",
        "| 排名 | 平台 | 分数 | 证据量 | 需求强度 | 付费/替代 | 接入可行性假设 | 人群清晰度 | 关键词清晰度 | 风险扣分 | 建议 |",
        "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ]
    for idx, item in enumerate(scored, start=1):
        score = int(item["total"])
        if idx == 1 and score >= 30:
            suggestion = "优先验证/先做候选"
        elif score >= 45:
            suggestion = "可后续扩展"
        else:
            suggestion = "暂不建议单独切入"
        lines.append(
            f"| {idx} | {_platform_label(item['platform'])} | {score} | {item['count']} | "
            f"{item['demand']} | {item['paid_alt']} | {item['feasibility']} | "
            f"{item['persona']} | {item['keyword']} | {item['risk']} | {suggestion} |"
        )
    if not scored:
        lines.append("| - | 暂无明确平台 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 先补平台证据 |")
    lines.append("")
    return lines


def _platform_channel_followup_md(planned_channels: list[str], channel_groups: dict[str, list[dict]]) -> list[str]:
    next_step_by_channel = {
        "reddit": "补 Slack、Microsoft Teams、Discord 与 action items/task/reminder 组合词，并复核高价值原帖正文。",
        "appstore": "补 Slack、Microsoft Teams、飞书、钉钉、企业微信、SCRM/团长工具等应用评论，按国内/海外分组。",
        "v2ex": "补企业微信、飞书、钉钉、Slack、Microsoft Teams 与机器人/API/导出/行动项等技术词。",
        "xiaohongshu": "补飞书、钉钉、企业微信、QQ 群等中文生活/工作场景词，重点看评论里的平台上下文。",
        "zhihu": "补非微信平台的问题式关键词，如飞书任务、钉钉群待办、Slack 待办、Teams 行动项。",
        "wechat-ecosystem": "作为微信原生供给和风险补证渠道，暂不用于证明其他 IM 平台需求。",
    }
    lines = [
        "## 平台补证优先级",
        "",
        "| 渠道 | 平台明确 | 平台未知 | 非微信平台线索 | 当前平台分布 | 优先级 | 下一步补证 |",
        "|---|---:|---:|---:|---|---|---|",
    ]
    for channel in planned_channels:
        rows = _non_noise_rows(channel_groups.get(channel, []))
        known = [row for row in rows if _platform_key(row) != "unknown"]
        unknown = [row for row in rows if _platform_key(row) == "unknown"]
        non_wechat = [row for row in known if _platform_key(row) != "wechat"]
        distribution = Counter(_platform_key(row) for row in rows)
        distribution_text = "、".join(f"{_platform_label(platform)} {count}" for platform, count in distribution.most_common(4)) or "暂无"
        if channel in {"reddit", "appstore", "v2ex"}:
            priority = "P0"
        elif channel in {"xiaohongshu", "zhihu", "weibo", "jike"}:
            priority = "P1"
        elif channel == "wechat-ecosystem":
            priority = "P2"
        else:
            priority = "P1" if unknown else "P2"
        lines.append(
            f"| {_channel_label(channel)} | {len(known)} | {len(unknown)} | {len(non_wechat)} | "
            f"{_cell(distribution_text, 140)} | {priority} | {_cell(next_step_by_channel.get(channel, '补平台关键词并重新 normalize/analyze。'), 180)} |"
        )
    lines.append("")
    return lines


def _scenario_appstore_market_summary_md(rows: list[dict], channel_config: dict) -> list[str]:
    if not rows:
        return []
    summaries = _appstore_market_counts(rows, _appstore_market_specs(channel_config))
    unresolved_domestic = _appstore_unresolved_domestic_stores(channel_config)
    domestic_partial_gaps = _appstore_domestic_partial_gaps(channel_config)
    lines = [
        "## 应用市场分组摘要",
        "",
        "该表只展示分组数量和渠道结论链接，具体评论正文见应用市场评论渠道文档。",
        "",
        "| 地区/渠道组 | 覆盖市场 | 评论线索 | 指标线索 | 代表 App | 状态 | 渠道结论 |",
        "|---|---|---:|---:|---|---|---|",
    ]
    for item in summaries:
        apps_text = "、".join(name for name, _ in item["apps"].most_common(4)) or "暂无"
        stores_text = "、".join(item["stores"]) or "未采集"
        if item["id"] == "domestic-android" and unresolved_domestic:
            stores_text = f"{stores_text}；待补：{'、'.join(unresolved_domestic)}"
        if item["review_count"] and item["metric_count"]:
            status = "已补评论+指标"
        elif item["review_count"]:
            status = "已补评论"
        elif item["metric_count"]:
            status = "仅补指标"
        else:
            status = "缺口"
        if item["id"] == "domestic-android" and unresolved_domestic:
            status = "部分完成：待补 " + "、".join(unresolved_domestic)
        elif item["id"] == "domestic-android" and domestic_partial_gaps:
            status = f"部分完成：存在 {len(domestic_partial_gaps)} 个覆盖缺口"
        group_label = f"{item['group']} / {item['name']}" if item["group"] else str(item["name"])
        lines.append(
            f"| {_cell(group_label, 90)} | {_cell(stores_text, 120)} | {item['review_count']} | {item['metric_count']} | "
            f"{_cell(apps_text, 140)} | {status} | [应用市场评论](channel-appstore.md) |"
        )
    lines.append("")
    return lines


def _persona_priority_md(rows: list[dict]) -> list[str]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        if not row.get("noise"):
            grouped[str(row.get("persona") or "unknown")].append(row)
    scored = []
    for persona, persona_rows in grouped.items():
        paid = sum(1 for row in persona_rows if row.get("signal_strength") == "paid_or_churn")
        manual = sum(1 for row in persona_rows if row.get("signal_strength") == "manual_workaround")
        strong = sum(1 for row in persona_rows if row.get("signal_strength") == "strong_complaint")
        score = len(persona_rows) + paid * 4 + manual * 2 + strong * 2
        scored.append((score, persona, len(persona_rows), paid, manual, strong))
    scored.sort(reverse=True)
    lines = [
        "## P0 人群候选",
        "",
        "| 优先级 | 人群 | 线索数 | 已付费/流失 | 已手动凑合 | 强情绪 | 判断 |",
        "|---|---|---:|---:|---:|---:|---|",
    ]
    for idx, (_, persona, total, paid, manual, strong) in enumerate(scored[:5], start=1):
        priority = "P0" if idx == 1 else f"P{idx - 1}"
        if paid or manual:
            judgment = "可进入访谈/Fake Door"
        elif strong:
            judgment = "先访谈确认付费"
        else:
            judgment = "仅保留观察"
        lines.append(f"| {priority} | {_label(persona, PERSONA_LABELS)} | {total} | {paid} | {manual} | {strong} | {judgment} |")
    if not scored:
        lines.append("| - | 暂无 | 0 | 0 | 0 | 0 | 待采集 |")
    lines.append("")
    return lines


def _scene_priority_md(rows: list[dict]) -> list[str]:
    lines = [
        "## 场景优先级",
        "",
        "| 优先级 | 场景 | 命中线索 | 已付费/流失 | 已手动凑合 | 强情绪 | 建议 |",
        "|---|---|---:|---:|---:|---:|---|",
    ]
    scored = []
    for scene, terms in SCENE_RULES:
        matched = [row for row in rows if not row.get("noise") and any(_has_term(_row_text(row), term) for term in terms)]
        paid = sum(1 for row in matched if row.get("signal_strength") == "paid_or_churn")
        manual = sum(1 for row in matched if row.get("signal_strength") == "manual_workaround")
        strong = sum(1 for row in matched if row.get("signal_strength") == "strong_complaint")
        score = len(matched) + paid * 4 + manual * 2 + strong * 2
        scored.append((score, scene, len(matched), paid, manual, strong))
    scored.sort(reverse=True)
    for idx, (_, scene, total, paid, manual, strong) in enumerate(scored, start=1):
        suggestion = "优先验证" if idx <= 2 and total else "补样本后判断"
        lines.append(f"| P{idx - 1} | {scene} | {total} | {paid} | {manual} | {strong} | {suggestion} |")
    lines.append("")
    return lines


def _hypothesis_summary_md(scenario: dict, rows: list[dict]) -> list[str]:
    hypotheses = scenario.get("hypotheses") or []
    lines = [
        "## 痛点假设清单",
        "",
        "| # | 假设 | 命中线索 | 状态 | 下一步 |",
        "|---:|---|---:|---|---|",
    ]
    for idx, hypothesis in enumerate(hypotheses, start=1):
        terms = [term for term in HYPOTHESIS_TERMS if term.lower() in hypothesis.lower()]
        matched = [row for row in rows if not row.get("noise") and terms and any(_has_term(_row_text(row), term) for term in terms)]
        status = "有支持" if len(matched) >= 3 else "待补"
        next_step = "进入访谈脚本" if status == "有支持" else "补抓同类线索"
        lines.append(f"| {idx} | {_cell(hypothesis, 160)} | {len(matched)} | {status} | {next_step} |")
    if not hypotheses:
        lines.append("| - | 未配置假设 | 0 | 待配置 | 在 scenario 配置中补充 hypotheses |")
    lines.append("")
    return lines


def _summary_next_steps_md(rows: list[dict], acceptance: dict, planned_channels: list[str], channel_groups: dict[str, list[dict]]) -> list[str]:
    failures = _acceptance_failures_for_spec(rows, acceptance.get("overall", {}))
    missing_channels = [channel for channel in planned_channels if not channel_groups.get(channel)]
    privacy_count = _bucket_counts(rows)["privacy_risk"]
    lines = ["## 下一步实验计划", ""]
    if failures:
        lines.append(f"- 补齐总体验收缺口：{'；'.join(failures[:3])}。")
    if missing_channels:
        lines.append(f"- 优先补未采集渠道：{'、'.join(_channel_label(channel) for channel in missing_channels[:5])}。")
    lines.append("- 基于当前高信号场景设计 JTBD 访谈，重点问上次漏事损失、现在怎么凑合、是否已经付费。")
    lines.append("- 做 Fake Door / 早鸟付费页，分别测试“聊天/群消息今日待处理”和“会议后自动整理行动项”。")
    if privacy_count:
        lines.append("- 同步做本地处理/用户授权/指定群读取 demo，验证合规与信任是否能转化为留资或付费意愿。")
    lines.append("")
    return lines


def _latest_delta_reports_md(root: Path, scenario_id: str) -> list[str]:
    reports = latest_delta_reports(root, scenario_id, limit=3)
    lines = ["## 最近增量补采影响", ""]
    if not reports:
        lines += ["- 暂无增量补采报告。", ""]
        return lines
    lines += [
        "| Batch | 有效新增线索 | 合并去重线索 | 关联线索 | 报告 |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    for report in reports:
        batch_id = report.get("batch_id", "")
        md_path = Path(str(report.get("_md_path") or ""))
        link = f"[{batch_id}](deltas/{md_path.name})" if md_path.name else str(batch_id)
        lines.append(
            f"| {batch_id} | {report.get('effective_new_evidence_count', 0)} | "
            f"{report.get('merged_existing_evidence_count', 0)} | "
            f"{report.get('batch_linked_evidence_count', 0)} | {link} |"
        )
    lines.append("")
    return lines


def _validation_md(rows: list[dict]) -> list[str]:
    counts = _bucket_counts(rows)
    non_noise = len([row for row in rows if not row.get("noise")])
    query_counts = Counter(row.get("query") for row in rows if row.get("query") and not row.get("noise"))
    scene_words = "、".join(key for key, _ in query_counts.most_common(8)) or "无"
    lines = [
        "## 验证信号汇总",
        "",
        "下表是基于标准化线索的启发式计数，不等同于市场规模估算。",
        "",
        "| 验证目标 | 命中线索数 | 解读 |",
        "|---|---:|---|",
        f"| 真实工作/生活场景 | {_count_rows_matching(rows, ['real_work_scene', 'real_life_scene'])} / {non_noise} | 工作场景和个人提醒场景应分开判断，避免混成泛效率需求。 |",
        f"| 强情绪 | {counts['strong_emotion']} / {non_noise} | 命中越多，越说明用户处在痛点而非单纯好奇。 |",
        f"| 现有凑合方案：IM/协作平台内 | {_count_rows_matching(rows, ['wechat_workaround'])} / {non_noise} | 用户已经在改造群聊、置顶、提醒、频道或平台内协作能力。 |",
        f"| 现有凑合方案：AI/脚本 | {_count_rows_matching(rows, ['ai_workaround'])} / {non_noise} | 说明存在主动找方案、搭工具、求教程的需求。 |",
        f"| 现有凑合方案：待办/提醒工具 | {_count_rows_matching(rows, ['todo_tool_workaround'])} / {non_noise} | 说明后续要和既有提醒类产品做清晰区分。 |",
        f"| 隐私/合规风险 | {counts['privacy_risk']} / {non_noise} | 命中越多，越需要优先验证数据读取和部署方式。 |",
        f"| 候选场景词 | {len(query_counts)} 个检索词 | {scene_words} |",
        "",
    ]
    return lines


def _counter_md(title: str, counter: Counter, labels: dict[str, str] | None = None, level: int = 2) -> list[str]:
    heading = "#" * level
    lines = [f"{heading} {title}", "", "| 项目 | 数量 |", "|---|---:|"]
    for key, value in counter.most_common():
        lines.append(f"| {_label(key, labels)} | {value} |")
    lines.append("")
    return lines


def _record_type_legend_md() -> list[str]:
    return [
        "类型口径：",
        "",
        "- 应用市场评价：App Store、Google Play、应用宝、华为、OPPO 等应用市场中的用户评分评论，通常带星级。",
        "- 社区评论/楼中评论：小红书、V2EX、Reddit、知乎等帖子或笔记下面的评论、楼中回复。",
        "- 社区原帖/主贴：社区帖子、笔记或主题正文。",
        "- 评分/指数指标：评分人数、星级分布、下载量、搜索指数等非正文指标。",
        "",
    ]


def _cell(value: object, limit: int = 160) -> str:
    text = str(value or "")
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"</?[a-zA-Z][^>]*>", " ", text)
    text = text.replace("|", " ").replace("\r", " ").replace("\n", " ").replace("\t", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def _safe_url(url: object) -> str:
    value = str(url or "")
    if "xiaohongshu.com/explore/" in value:
        return value.split("?", 1)[0]
    return value


def _source_label(row: dict) -> str:
    source = row.get("title") or row.get("source_id")
    if row.get("record_type") == "comment" and row.get("comment_id"):
        source = f"{source} / 评论 {row.get('comment_id')}"
    return _cell(source, 80)


def _signal_text(row: dict) -> str:
    if row.get("comment_signal"):
        return _cell(_translate_signal_terms(row.get("comment_signal")), 180)
    metrics = row.get("metrics") or {}
    metric_bits = []
    for key in ["like", "sub_comment_count", "comments_fetched", "comment_pages"]:
        if metrics.get(key) not in ("", None):
            metric_bits.append(f"{_label(key, METRIC_LABELS)}={metrics.get(key)}")
    prefix = "; ".join(metric_bits)
    if prefix:
        return _cell(f"{_label(row.get('signal_strength'), SIGNAL_LABELS)} ({prefix})", 180)
    return _cell(_label(row.get("signal_strength"), SIGNAL_LABELS), 180)


def _metric_int(row: dict, key: str) -> int:
    try:
        return int((row.get("metrics") or {}).get(key) or 0)
    except (TypeError, ValueError):
        return 0


def _evidence_sort_key(row: dict) -> tuple:
    return (
        bool(row.get("noise")),
        row.get("confidence") != "A",
        SIGNAL_RANK.get(row.get("signal_strength"), 9),
        row.get("record_type") != "post",
        -_metric_int(row, "like"),
        row.get("source_id", ""),
    )


def _evidence_table(rows: list[dict], limit: int = 20) -> list[str]:
    lines = ["## 代表性线索", "", "| 置信度 | 类型 | 渠道 | 平台 | 检索词 | 来源 | 原文/摘录 | 信号 |", "|---|---|---|---|---|---|---|---|"]
    for row in rows[:limit]:
        url = _safe_url(row.get("source_url"))
        source = _source_label(row)
        link = f"[{source}]({url})" if url else source
        lines.append(
            f"| {_confidence_label(row.get('confidence'))} | {_record_type_label(row.get('record_type', 'post'))} | {_channel_label(row.get('channel'))} | {_platform_label(row.get('primary_platform'))} | "
            f"{_cell(row.get('query'), 50)} | {link} | {_cell(row.get('quote'), 180)} | {_signal_text(row)} |"
        )
    lines.append("")
    return lines


def _pass_fail(current: int, target: int) -> str:
    return "通过" if current >= target else "未通过"


def _acceptance_line(name: str, target: int | str, current: int | str, passed: bool) -> str:
    return f"| {name} | {target} | {current} | {'通过' if passed else '未通过'} |"


def _acceptance_md(rows: list[dict], acceptance: dict, channel: str | None = None) -> list[str]:
    spec = (acceptance.get("channels") or {}).get(channel, {}) if channel else acceptance.get("overall", {})
    if not spec:
        return ["未配置验收标准。", ""]
    a_count = sum(1 for row in rows if row.get("confidence") == "A")
    b_count = sum(1 for row in rows if row.get("confidence") == "B")
    noise_count = sum(1 for row in rows if row.get("confidence") == "N" or row.get("evidence_role") == "noise")
    app_review_count = sum(
        1
        for row in rows
        if row.get("record_type") == "review" and row.get("channel") in {"appstore", "google-play"}
    )
    community_count = sum(1 for row in rows if row.get("channel") in {"xiaohongshu", "v2ex", "zhihu", "wechat-ecosystem", "weibo", "reddit", "jike"})
    competitor_count = sum(1 for row in rows if row.get("record_type") == "competitor" or row.get("evidence_role") == "competitor")
    metric_count = sum(1 for row in rows if row.get("record_type") in {"metric", "search_index"})

    metric_values = {
        "min_total_evidence": ("总线索", len(rows)),
        "min_a_evidence": ("A 类线索", a_count),
        "min_b_evidence": ("B 类线索", b_count),
        "min_noise_evidence": ("噪声/反向线索", noise_count),
        "min_metric_evidence": ("指数/指标线索", metric_count),
        "min_app_store_reviews": ("应用商店评论", app_review_count),
        "min_community_evidence": ("社区线索", community_count),
        "min_competitor_evidence": ("竞品/开源/定价线索", competitor_count),
    }
    lines = ["| 指标 | 目标 | 当前 | 状态 |", "|---|---:|---:|---|"]
    for key, (label, current) in metric_values.items():
        if key in spec:
            target = int(spec[key])
            lines.append(_acceptance_line(label, target, current, current >= target))
    if spec.get("must_have_channel_conclusion") is not None:
        current = "已生成" if rows else "无数据"
        lines.append(_acceptance_line("渠道结论", "必须有", current, bool(rows)))
    lines.append("")
    return lines


def _acceptance_failures(rows: list[dict], acceptance: dict, channel: str) -> list[dict]:
    spec = (acceptance.get("channels") or {}).get(channel, {})
    if not spec:
        return []
    counts = {
        "min_total_evidence": len(rows),
        "min_a_evidence": sum(1 for row in rows if row.get("confidence") == "A"),
        "min_b_evidence": sum(1 for row in rows if row.get("confidence") == "B"),
        "min_noise_evidence": sum(1 for row in rows if row.get("confidence") == "N" or row.get("evidence_role") == "noise"),
        "min_metric_evidence": sum(1 for row in rows if row.get("record_type") in {"metric", "search_index"}),
    }
    labels = {
        "min_total_evidence": "总线索不足",
        "min_a_evidence": "A 类线索不足",
        "min_b_evidence": "B 类标题/补充线索不足",
        "min_noise_evidence": "噪声/反向线索不足",
        "min_metric_evidence": "指数/指标线索不足",
    }
    gaps = []
    priority = "P1" if spec.get("severity") == "warning" else "P0"
    for key, current in counts.items():
        if key in spec and current < int(spec[key]):
            gaps.append({
                "gap": labels[key],
                "why_it_matters": "未达到渠道验收标准会导致结论偏窄或缺少反向证据。",
                "fill_method": f"继续补抓该渠道；当前 {current}，目标 {spec[key]}。",
                "priority": priority,
            })
    return gaps


def _keyword_matrix_md(keyword_matrix: dict, channel: str | None = None, include_english: bool = True) -> list[str]:
    if not keyword_matrix:
        return ["未配置关键词矩阵。", ""]
    if include_english:
        lines = ["| 类别 | 中文关键词 | 英文关键词 | 用途 |", "|---|---|---|---|"]
    else:
        lines = ["| 类别 | 中文关键词 | 用途 |", "|---|---|---|"]
    for category in keyword_matrix.get("categories", []):
        if channel and channel not in category.get("channels", []):
            continue
        if include_english:
            lines.append(
                f"| {category.get('name', category.get('id', ''))} | "
                f"{_cell('；'.join(category.get('zh', [])), 220)} | "
                f"{_cell('；'.join(category.get('en', [])), 180)} | "
                f"{_cell(category.get('purpose', ''), 220)} |"
            )
        else:
            lines.append(
                f"| {category.get('name', category.get('id', ''))} | "
                f"{_cell('；'.join(category.get('zh', [])), 260)} | "
                f"{_cell(category.get('purpose', ''), 260)} |"
            )
    if channel:
        keywords = keyword_matrix.get("channel_keywords", {}).get(channel, [])
        lines += ["", f"本渠道执行关键词：{_cell('、'.join(keywords), 500)}", ""]
    else:
        lines.append("")
    return lines


def _crawl_plan_md(channel_config: dict) -> list[str]:
    plan = channel_config.get("crawl_plan") or {}
    if not plan:
        return ["未配置抓取方案。", ""]
    capture = "、".join(plan.get("capture", []))
    keywords = "、".join(plan.get("keywords", []))
    market_segments = plan.get("market_segments", [])
    app_categories = plan.get("app_categories", [])
    search_top_n = plan.get("search_top_n", "未配置")
    detail_top_n = plan.get("detail_top_n", "未配置")
    comments_top_n = plan.get("comments_top_n", "未配置")
    input_format = plan.get("input_format", "")
    method_order = plan.get("method_order", [])
    search_desc = f"每词前 {search_top_n} 条" if isinstance(search_top_n, int) else str(search_top_n)
    detail_desc = f"每词/候选前 {detail_top_n} 条" if isinstance(detail_top_n, int) else str(detail_top_n)
    comments_desc = f"每条详情前 {comments_top_n} 条" if isinstance(comments_top_n, int) else str(comments_top_n)
    market_desc = "；".join(
        f"{item.get('name')}: {item.get('scope')}" for item in market_segments if item.get("name")
    )
    category_desc = "；".join(
        f"{item.get('name')}: {'、'.join(item.get('keywords', []))}" for item in app_categories if item.get("name")
    )
    lines = [
        "| 项目 | 内容 |",
        "|---|---|",
        f"| 采集器 | {_cell(channel_config.get('collector', ''))} |",
        f"| 抓取内容 | {_cell(capture, 260)} |",
        f"| 搜索结果数 | {_cell(search_desc, 120)} |",
        f"| 详情数 | {_cell(detail_desc, 120)} |",
        f"| 评论数 | {_cell(comments_desc, 120)} |",
        f"| 关键词 | {_cell(keywords, 500)} |",
    ]
    if market_desc:
        lines.append(f"| 应用市场分层 | {_cell(market_desc, 520)} |")
    if category_desc:
        lines.append(f"| 产品品类 | {_cell(category_desc, 520)} |")
    if method_order:
        lines.append(f"| 抓取顺序 | {_cell(' → '.join(str(item) for item in method_order), 620)} |")
    if input_format:
        lines.append(f"| 导入格式 | {_cell(input_format, 260)} |")
    lines.append("")
    return lines


def _gap_md(rows: list[dict], channel_config: dict, acceptance: dict, channel: str) -> list[str]:
    gaps = _acceptance_failures(rows, acceptance, channel)
    gaps.extend(channel_config.get("known_gaps", []))
    if not rows:
        gaps.insert(0, {
            "gap": "渠道尚未采集",
            "why_it_matters": "计划渠道没有标准化线索，不能支撑场景级判断。",
            "fill_method": "按本渠道抓取方案导入原始数据后重新 normalize/audit/analyze。",
            "priority": "P0",
        })
    if not gaps:
        return ["当前未发现渠道级阻断缺口。", ""]
    lines = ["| 缺口 | 为什么重要 | 补齐方式 | 优先级 |", "|---|---|---|---|"]
    for gap in gaps:
        lines.append(
            f"| {_cell(gap.get('gap'), 100)} | {_cell(gap.get('why_it_matters'), 180)} | "
            f"{_cell(gap.get('fill_method'), 180)} | {_cell(gap.get('priority'), 20)} |"
        )
    lines.append("")
    return lines


def _evidence_refs(rows: list[dict], terms: list[str], limit: int = 3) -> str:
    refs = []
    for row in sorted(rows, key=_evidence_sort_key):
        text = _row_text(row)
        if not any(_has_term(text, term) for term in terms):
            continue
        source = _source_label(row)
        url = _safe_url(row.get("source_url"))
        quote = _cell(row.get("quote"), 46)
        refs.append(f"[{source}]({url})：「{quote}」" if url else f"{source}：「{quote}」")
        if len(refs) >= limit:
            break
    return "；".join(refs) if refs else "暂无直接线索"


def _count_rows_by_terms(rows: list[dict], terms: list[str]) -> int:
    return sum(
        1
        for row in rows
        if not row.get("noise") and any(_has_term(_row_text(row), term) for term in terms)
    )


def _appstore_row_context(row: dict) -> str:
    metrics = row.get("metrics") or {}
    return " ".join(
        str(part or "")
        for part in [
            row.get("query"),
            row.get("title"),
            row.get("quote"),
            metrics.get("app_name"),
            metrics.get("app_id"),
        ]
    ).lower()


def _term_matches_context(context: str, terms: list[str]) -> bool:
    compact_context = re.sub(r"[\s:：_/\\-]+", "", context.lower())
    for term in terms:
        lowered = str(term or "").lower()
        if not lowered:
            continue
        compact_term = re.sub(r"[\s:：_/\\-]+", "", lowered)
        if _has_term(context, lowered) or (compact_term and compact_term in compact_context):
            return True
    return False


def _appstore_category_specs(channel_config: dict) -> list[dict]:
    specs = (channel_config.get("crawl_plan") or {}).get("app_categories") or []
    if specs:
        return specs
    return [
        {
            "id": "todo_task",
            "name": "待办/任务/提醒类",
            "keywords": ["滴答清单", "TickTick", "微软 To Do", "Microsoft To Do", "Todoist"],
            "validation_goal": "验证提醒、同步、任务创建和订阅付费后的不满。",
        },
        {
            "id": "meeting_transcription",
            "name": "会议纪要/转写/行动项类",
            "keywords": ["讯飞听见", "飞书妙记", "飞书", "Lark", "Otter", "Fireflies"],
            "validation_goal": "验证语音转文字、会议总结、行动项提取和总结质量阻力。",
        },
        {
            "id": "ai_schedule_assistant",
            "name": "AI 助手/日程自动化类",
            "keywords": ["通义听悟", "千问", "Motion", "Reclaim"],
            "validation_goal": "验证 AI 自动整理、日程/任务自动化和高阶生产力工具的付费心智。",
        },
    ]


def _appstore_category_id(row: dict, specs: list[dict]) -> str:
    context = _appstore_row_context(row)
    for spec in specs:
        if _term_matches_context(context, list(spec.get("keywords") or [])):
            return str(spec.get("id") or spec.get("name") or "unknown")
    return "__uncategorized"


def _appstore_target_label(row: dict) -> str:
    return str((row.get("metrics") or {}).get("app_name") or row.get("query") or row.get("title") or "未知 App")


def _appstore_market_specs(channel_config: dict) -> list[dict]:
    specs = (channel_config.get("crawl_plan") or {}).get("market_segments") or []
    if specs:
        return specs
    return [
        {"id": "app-store-cn", "name": "国内 iOS：App Store 中国区", "group": "国内应用市场"},
        {"id": "app-store-overseas", "name": "海外 iOS：App Store US", "group": "海外应用市场"},
        {"id": "google-play", "name": "海外 Android：Google Play", "group": "海外应用市场"},
        {"id": "domestic-android", "name": "国内 Android 应用市场汇总", "group": "国内应用市场"},
    ]


def _appstore_unresolved_domestic_stores(channel_config: dict) -> list[str]:
    targets = ((channel_config.get("crawl_plan") or {}).get("android_market_targets") or {})
    return [str(store) for store in targets.get("domestic_unresolved_stores", []) if str(store)]


def _appstore_domestic_partial_gaps(channel_config: dict) -> list[str]:
    targets = ((channel_config.get("crawl_plan") or {}).get("android_market_targets") or {})
    return [str(gap) for gap in targets.get("domestic_partial_gaps", []) if str(gap)]


def _appstore_market_segment(row: dict) -> str:
    metrics = row.get("metrics") or {}
    segment = str(metrics.get("market_segment") or "")
    if segment:
        return segment
    country = str(metrics.get("country") or "").lower()
    if country == "cn":
        return "app-store-cn"
    if country == "us":
        return "app-store-overseas"
    return "unknown"


def _appstore_store_name(row: dict) -> str:
    metrics = row.get("metrics") or {}
    if metrics.get("store_name"):
        return str(metrics.get("store_name"))
    segment = _appstore_market_segment(row)
    if segment == "app-store-cn":
        return "App Store CN"
    if segment == "app-store-overseas":
        return "App Store US"
    if segment == "google-play":
        return "Google Play"
    if segment == "domestic-android":
        return "国内 Android 应用市场"
    return "未知市场"


def _appstore_market_counts(rows: list[dict], specs: list[dict]) -> list[dict]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        if not row.get("noise"):
            grouped[_appstore_market_segment(row)].append(row)
    summaries = []
    for spec in specs:
        segment_id = str(spec.get("id") or "")
        segment_rows = grouped.get(segment_id, [])
        review_count = sum(1 for row in segment_rows if row.get("record_type") == "review")
        metric_count = sum(1 for row in segment_rows if row.get("record_type") == "metric")
        stores = sorted({_appstore_store_name(row) for row in segment_rows})
        apps = Counter(_appstore_target_label(row) for row in segment_rows)
        dimension_counts = Counter(row.get("pain_dimension") for row in segment_rows if row.get("record_type") == "review")
        rating_counts = Counter(str((row.get("metrics") or {}).get("rating", "")) for row in segment_rows if row.get("record_type") == "review")
        paid_count = sum(1 for row in segment_rows if row.get("signal_strength") == "paid_or_churn")
        strong_count = sum(1 for row in segment_rows if row.get("signal_strength") == "strong_complaint")
        summaries.append({
            "id": segment_id,
            "name": spec.get("name") or segment_id,
            "group": spec.get("group") or "",
            "rows": segment_rows,
            "review_count": review_count,
            "metric_count": metric_count,
            "stores": stores,
            "apps": apps,
            "dimensions": dimension_counts,
            "ratings": rating_counts,
            "paid_count": paid_count,
            "strong_count": strong_count,
        })
    return summaries


def _appstore_market_status_md(rows: list[dict], channel_config: dict) -> list[str]:
    specs = _appstore_market_specs(channel_config)
    summaries = _appstore_market_counts(rows, specs)
    unresolved_domestic = _appstore_unresolved_domestic_stores(channel_config)
    domestic_partial_gaps = _appstore_domestic_partial_gaps(channel_config)
    lines = [
        "### 应用市场分组覆盖状态",
        "",
        "| 地区/渠道组 | 覆盖市场 | 当前结果 | 判定 | 下一步 |",
        "|---|---|---|---|---|",
    ]
    for item in summaries:
        apps_text = "、".join(f"{name} {count}条" for name, count in item["apps"].most_common(4)) or "暂无"
        stores_text = "、".join(item["stores"]) or "未采集"
        if item["id"] == "domestic-android" and unresolved_domestic:
            stores_text = f"{stores_text}；待补：{'、'.join(unresolved_domestic)}"
        elif item["id"] == "domestic-android" and domestic_partial_gaps:
            stores_text = f"{stores_text}；部分缺口：{len(domestic_partial_gaps)}项"
        current = f"评论 {item['review_count']} 条；指标 {item['metric_count']} 条；App：{apps_text}"
        if item["review_count"] and item["metric_count"]:
            status = "已补评论+指标"
        elif item["review_count"]:
            status = "已补评论"
        elif item["metric_count"]:
            status = "仅补指标"
        else:
            status = "缺口"
        if item["id"] == "domestic-android" and unresolved_domestic:
            status = "部分完成"
        elif item["id"] == "domestic-android" and domestic_partial_gaps:
            status = "部分完成"
        if item["id"] == "domestic-android":
            if unresolved_domestic:
                next_step = f"继续补齐 {'、'.join(unresolved_domestic)} 的逐条低分评论；当前国内安卓作为一类渠道汇总，不拆成多个渠道结论。"
            elif domestic_partial_gaps:
                next_step = f"国内安卓保持一类渠道汇总；优先处理 {len(domestic_partial_gaps)} 个覆盖缺口，详见本渠道缺口表。"
            else:
                next_step = "复查各国内安卓商店分页评论和目标 App 覆盖，不拆成多个渠道结论。"
        elif item["id"] == "google-play":
            next_step = "补 Reclaim 或同类 AI 日程 Android 样本，复查更多分页评论。"
        else:
            next_step = "保持每个代表 App 10-30 条低星评论。"
        group_label = f"{item['group']} / {item['name']}" if item["group"] else str(item["name"])
        lines.append(
            f"| {_cell(group_label, 90)} | {_cell(stores_text, 140)} | "
            f"{_cell(current, 220)} | {status} | {_cell(next_step, 180)} |"
        )
    lines.append("")
    return lines


def _appstore_category_conclusion_md(rows: list[dict], channel_config: dict) -> list[str]:
    specs = _appstore_category_specs(channel_config)
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        if not row.get("noise"):
            grouped[_appstore_category_id(row, specs)].append(row)
    lines = [
        "### 按产品品类归类的差评结果",
        "",
        "| 产品品类 | 样本覆盖 | 主要差评焦点 | 证据 | 结论/产品含义 |",
        "|---|---|---|---|---|",
    ]
    for spec in specs:
        spec_id = str(spec.get("id") or spec.get("name") or "unknown")
        cat_rows = grouped.get(spec_id, [])
        review_rows = [row for row in cat_rows if row.get("record_type") == "review"]
        metric_rows = [row for row in cat_rows if row.get("record_type") == "metric"]
        target_counts = Counter(_appstore_target_label(row) for row in cat_rows)
        dimension_counts = Counter(row.get("pain_dimension") for row in review_rows)
        strong_count = sum(1 for row in review_rows if row.get("signal_strength") == "strong_complaint")
        paid_count = sum(1 for row in review_rows if row.get("signal_strength") == "paid_or_churn")
        target_text = "、".join(f"{name} {count}条" for name, count in target_counts.most_common(5)) or "暂无"
        low_sample = [f"{name} {count}条" for name, count in target_counts.items() if count < 10]
        coverage = f"评论 {len(review_rows)} 条；指标 {len(metric_rows)} 条；目标 App：{target_text}"
        focus = "、".join(f"{_label(dim, PAIN_DIMENSION_LABELS)} {count}" for dim, count in dimension_counts.most_common(3)) or "暂无"
        focus = f"{focus}；强情绪 {strong_count}；已付费/流失 {paid_count}"
        meaning = str(spec.get("validation_goal") or "")
        if len(target_counts) < 2:
            meaning += "；该品类代表 App 少于 2 个，仍需补样本。"
        if low_sample:
            meaning += f"；未达每 App 10 条目标：{'、'.join(low_sample[:4])}。"
        evidence = _evidence_refs(cat_rows, list(spec.get("keywords") or []), limit=3) if cat_rows else "暂无直接线索"
        lines.append(
            f"| {_cell(spec.get('name'), 80)} | {_cell(coverage, 180)} | {_cell(focus, 180)} | "
            f"{evidence} | {_cell(meaning, 260)} |"
        )
    uncat_rows = grouped.get("__uncategorized", [])
    if uncat_rows:
        target_counts = Counter(_appstore_target_label(row) for row in uncat_rows)
        lines.append(
            f"| 未归类 App | {len(uncat_rows)} 条；{_cell('、'.join(target_counts.keys()), 120)} | "
            f"{_cell('需人工确认是否属于 Notion 目标品类。', 120)} | {_evidence_refs(uncat_rows, [], limit=3)} | 后续补 app_categories 规则或剔除噪声。 |"
        )
    lines.append("")
    return lines


def _appstore_cross_category_conclusion_md(rows: list[dict]) -> list[str]:
    review_rows = [row for row in rows if not row.get("noise") and row.get("record_type") == "review"]
    metric_rows = [row for row in rows if not row.get("noise") and row.get("record_type") == "metric"]
    review_count = len(review_rows)
    rating_counts = Counter(str((row.get("metrics") or {}).get("rating", "")) for row in review_rows)
    strong_count = sum(1 for row in review_rows if row.get("signal_strength") == "strong_complaint")
    paid_count = _count_rows_by_terms(review_rows, ["会员", "订阅", "退款", "扣费", "pro", "收费", "充了钱"])
    stability_count = _count_rows_by_terms(review_rows, ["崩溃", "闪退", "登录", "登陆", "同步", "提醒", "不能用", "error", "卡"])
    quality_count = _count_rows_by_terms(review_rows, ["不准", "准确", "识别", "转写", "总结", "translation", "transcription", "wrong", "summary"])
    usability_count = _count_rows_by_terms(review_rows, ["难用", "麻烦", "找不到", "入口", "interface", "confusing", "bloated", "manual"])
    ai_meeting_count = _count_rows_by_terms(review_rows, ["会议", "纪要", "总结", "转文字", "录音", "自动加入", "ai"])
    rating_summary = "，".join(
        f"{rating} 星 {count}" for rating, count in sorted(rating_counts.items()) if rating
    ) or "暂无评分"
    lines = ["### 跨品类验证结论", "", "| 验证目标 | 结论 | 证据 | 产品含义 |", "|---|---|---|---|"]
    lines.append(
        f"| 未满足需求与强情绪 | 成立，采集 {review_count} 条 1-3 星评论、{len(metric_rows)} 条评分指标，其中 {rating_summary}，强情绪 {strong_count} 条。 | "
        f"{_evidence_refs(review_rows, ['垃圾', '难用', '崩溃', '闪退', '生气', '流氓', '差评', 'error'])} | "
        "用户对基础稳定性、入口清晰度和关键功能缺失容忍度低。 |"
    )
    lines.append(
        f"| 付费后不满/退订/退款 | 命中 {paid_count}/{review_count} 条评论。 | "
        f"{_evidence_refs(review_rows, ['会员', '订阅', '退款', '扣费', 'pro', '收费', '充了钱'])} | "
        "定价和试用边界必须透明，避免首屏强推会员、误扣费、付费后核心能力仍不可用。 |"
    )
    lines.append(
        f"| 准确率/稳定性/易用性阻力 | 稳定/提醒/同步命中 {stability_count}/{review_count}，准确率/质量命中 {quality_count}/{review_count}，易用性交互命中 {usability_count}/{review_count}。 | "
        f"{_evidence_refs(review_rows, ['崩溃', '闪退', '登录', '登陆', '同步', '提醒', '不能用', 'error', '卡'])} | "
        "待办类产品的登录、同步、提醒、提交任务是底线能力，不能只突出 AI。 |"
    )
    lines.append(
        f"| 内容到结构化的付费心智 | AI/会议/转写/总结命中 {ai_meeting_count}/{review_count} 条评论。 | "
        f"{_evidence_refs(review_rows, ['会议', '纪要', '总结', '转文字', '录音', '自动加入', 'ai'])} | "
        "自动入会、总结质量和可关闭/可控范围是会议行动项方向的关键风险。 |"
    )
    lines.append(
        f"| 与 IM/聊天待办场景的关系 | 间接支持，应用市场评论主要证明竞品体验/付费阻力，不直接证明具体 IM 原生场景频率。 | "
        f"{_evidence_refs(review_rows, ['待办', '提醒', '任务', '会议'])} | "
        "场景真实性仍以小红书、V2EX、知乎和访谈为主，应用市场用来校准差异化和避坑。 |"
    )
    lines.append("")
    return lines


def _appstore_conclusion_md(rows: list[dict], channel_config: dict) -> list[str]:
    lines: list[str] = []
    lines += _appstore_market_status_md(rows, channel_config)
    lines += _appstore_category_conclusion_md(rows, channel_config)
    lines += _appstore_cross_category_conclusion_md(rows)
    return lines


def _parse_metric_value(row: dict) -> float | None:
    metrics = row.get("metrics") or {}
    if not isinstance(metrics, dict):
        return None
    value = metrics.get("index_value")
    if value in ("", None):
        return None
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return None


def _metric_keyword(row: dict) -> str:
    metrics = row.get("metrics") or {}
    if isinstance(metrics, dict):
        return str(metrics.get("keyword") or row.get("query") or row.get("title") or "")
    return str(row.get("query") or row.get("title") or "")


def _metric_name(row: dict) -> str:
    metrics = row.get("metrics") or {}
    if isinstance(metrics, dict):
        return str(metrics.get("metric_name") or "")
    return ""


def _no_index_keywords(rows: list[dict]) -> list[str]:
    keywords = []
    seen = set()
    for row in rows:
        text = f"{_metric_name(row)} {row.get('quote', '')}"
        if "无可见数据" not in text and "未收录" not in text:
            continue
        keyword = str(row.get("query") or _metric_keyword(row)).strip()
        if not keyword or keyword in seen:
            continue
        seen.add(keyword)
        keywords.append(keyword)
    return keywords


def _long_tail_summary_text(rows: list[dict], limit: int = 6) -> str:
    items = []
    for row in rows:
        metrics = row.get("metrics") or {}
        if not isinstance(metrics, dict):
            continue
        total = metrics.get("related_long_tail_total")
        if total in ("", None):
            continue
        indexed = metrics.get("indexed_word_count")
        keyword = metrics.get("keyword") or row.get("query")
        items.append((int(total or 0), str(keyword or ""), indexed))
    items.sort(reverse=True)
    if not items:
        return "暂无长尾概览"
    return "；".join(f"{keyword}: 长尾{total:g}，有指数{indexed}" for total, keyword, indexed in items[:limit])


def _top_metric_text(rows_with_value: list[tuple[dict, float]], limit: int = 5) -> str:
    top_rows = sorted(rows_with_value, key=lambda item: item[1], reverse=True)[:limit]
    if not top_rows:
        return "暂无可排序指数值"
    labels = []
    for row, value in top_rows:
        name = _metric_name(row)
        keyword = _metric_keyword(row)
        label = f"{keyword}={value:g}" if not name else f"{keyword}({name})={value:g}"
        labels.append(label)
    return "、".join(labels)


def _search_index_conclusion_md(rows: list[dict], channel_config: dict) -> list[str]:
    metric_rows = [row for row in rows if row.get("record_type") in {"metric", "search_index"} and not row.get("noise")]
    keyword_count = len({row.get("query") for row in metric_rows if row.get("query")})
    rows_with_value = [(row, _parse_metric_value(row)) for row in metric_rows]
    rows_with_value = [(row, value) for row, value in rows_with_value if value is not None]
    top_text = _top_metric_text(rows_with_value)
    no_index = _no_index_keywords(metric_rows)
    no_index_text = "、".join(no_index[:8]) if no_index else "暂无"
    long_tail_text = _long_tail_summary_text(metric_rows)
    period_counts = Counter(str((row.get("metrics") or {}).get("period") or (row.get("metrics") or {}).get("date") or "未标注周期") for row in metric_rows)
    period_text = "、".join(f"{period} {count}条" for period, count in period_counts.most_common(3)) or "暂无"
    platform_counts = Counter(row.get("primary_platform") for row in metric_rows)
    platform_text = "、".join(f"{_platform_label(platform)} {count}条" for platform, count in platform_counts.most_common(4)) or "暂无"
    channel_name = _channel_label(channel_config.get("id"))
    lines = ["| 验证目标 | 结论 | 证据 | 产品含义 |", "|---|---|---|---|"]
    lines.append(
        f"| 搜索/内容需求规模 | 已导入 {len(metric_rows)} 条指标，覆盖 {keyword_count} 个关键词。 | "
        f"Top 指数词：{_cell(top_text, 180)}；周期覆盖：{_cell(period_text, 140)} | "
        "只能说明相对热度和触达潜力，不能替代真实用户原文。 |"
    )
    lines.append(
        f"| 关键词收录情况 | 未收录/无可见指数关键词：{_cell(no_index_text, 180)}。 | "
        f"5118 长尾概览：{_cell(long_tail_text, 220)} | "
        "未收录词更适合作为访谈/社区补证词，不能直接拿去做规模化投放。 |"
    )
    lines.append(
        f"| 触达词优先级 | 当前可优先复核高指数词和高意图词。 | {_cell(top_text, 180)} | "
        "高指数词进入内容标题、SEO/Fake Door 和社区补采；低指数但强痛点词保留给访谈验证。 |"
    )
    lines.append(
        f"| 平台方向校准 | 平台命中分布：{_cell(platform_text, 160)}。 | "
        f"{_evidence_refs(metric_rows, ['微信', '企业微信', '飞书', '钉钉', 'slack', 'teams'])} | "
        "指数平台只做平台词规模校准，先做哪个 IM 平台仍要结合 API/授权/合规可行性。 |"
    )
    lines.append(
        f"| 证据限制 | {channel_name} 是指标层证据，不验证情绪强度、凑合方案或付费意愿。 | "
        "record_type=metric，source_quality=metric_only | "
        "结论必须与小红书/V2EX/知乎/Reddit/应用市场的原文和评论交叉验证。 |"
    )
    lines.append("")
    return lines


def _channel_conclusion_md(rows: list[dict], channel_config: dict) -> list[str]:
    if not rows:
        return ["尚未采集到标准化线索，渠道结论待生成。", ""]
    if channel_config.get("id") == "appstore":
        return _appstore_conclusion_md(rows, channel_config)
    if channel_config.get("id") in SEARCH_INDEX_CHANNELS:
        return _search_index_conclusion_md(rows, channel_config)
    counts = _bucket_counts(rows)
    non_noise = len([row for row in rows if not row.get("noise")])
    lines = ["| 验证目标 | 结论 | 证据 | 产品含义 |", "|---|---|---|---|"]
    real_count = counts["real_work_scene"] + counts["real_life_scene"]
    real_count = _count_rows_matching(rows, ["real_work_scene", "real_life_scene"])
    lines.append(
        f"| 真实生活/工作场景 | {'成立' if real_count else '证据不足'}，命中 {real_count}/{non_noise} 条。 | "
        f"{_evidence_refs(rows, ['客户', '会议', '群消息', '待办', '提醒', 'meeting', 'client', 'customer', 'slack', 'task', 'follow up'])} | "
        "定位应落到具体任务流，而不是抽象信息过载。 |"
    )
    lines.append(
        f"| 情绪强度 | {'较强' if counts['strong_emotion'] else '待补'}，命中 {counts['strong_emotion']}/{non_noise} 条。 | "
        f"{_evidence_refs(rows, ['崩溃', '想吐', '折磨', '烦', '太麻烦', 'frustrated', 'overwhelmed', 'annoying', 'sucks', 'hate', 'pain', 'buried'])} | "
        "强情绪场景适合作为获客入口和访谈切入。 |"
    )
    workaround_count = _count_rows_matching(rows, ["wechat_workaround", "ai_workaround", "todo_tool_workaround"])
    lines.append(
        f"| 是否已有凑合方案 | {'成立' if workaround_count else '证据不足'}，命中 {workaround_count}/{non_noise} 条。 | "
        f"{_evidence_refs(rows, ['单人群', '置顶', 'AI', 'skill', 'wechat-cli', '提醒', 'notion', 'todoist', 'zapier', 'calendar', 'fireflies', 'otter', 'manual', 'app'])} | "
        "用户已投入时间找方案，产品要降低配置、稳定性和取数门槛。 |"
    )
    lines.append(
        f"| 关键阻力 | 隐私/合规/稳定性命中 {counts['privacy_risk']}/{non_noise} 条。 | "
        f"{_evidence_refs(rows, ['封号', '隐私', '合规', '爬取', '客户信息', 'privacy', 'security', 'permission', 'compliance', 'api'])} | "
        "必须前置本地处理、授权范围、指定群/联系人和稳定性说明。 |"
    )
    query_counts = Counter(row.get("query") for row in rows if row.get("query") and not row.get("noise"))
    scene_words = "、".join(key for key, _ in query_counts.most_common(8)) or "暂无"
    lines.append(
        f"| 适合投放的场景词 | 优先使用具体任务词。 | {scene_words} | "
        "落地页应使用“今天必须处理的事”“会议后行动项”“微信群日报”等具体表达。 |"
    )
    lines.append("")
    return lines


def _next_steps_md(rows: list[dict], channel_config: dict) -> list[str]:
    if not rows:
        return ["- 按抓取方案补采集该渠道数据，导入后重新生成渠道结论与场景汇总。", ""]
    if channel_config.get("id") == "appstore":
        market_counts = {item["id"]: item for item in _appstore_market_counts(rows, _appstore_market_specs(channel_config))}
        google_play = market_counts.get("google-play", {})
        domestic_android = market_counts.get("domestic-android", {})
        android_done = bool((google_play.get("review_count") or 0) and ((domestic_android.get("review_count") or 0) or (domestic_android.get("metric_count") or 0)))
        lines = [
            "- 将应用市场结果定位为竞品评论/评分信号，用于校准付费阻力、功能缺口和基础体验要求，不直接替代具体 IM 原生场景证据。",
            "- 国内和海外应用市场继续分组判断；国内 Android 按一类渠道汇总展示，不把应用宝或小米单点结果外推为全量安卓结论。",
            "- 继续把每个目标 App 的有效差评补到 10-30 条；不足 10 条的 App 在结论里保持样本不足标记。",
            "- 把差评高频阻力转成 Fake Door 和访谈问题：付费后仍不准/不同步/不提醒时是否会退款，是否接受本地处理和指定范围读取。",
        ]
        if not android_done:
            lines.insert(2, "- 优先补 Google Play 与国内安卓商店低分评论，尤其看权限、广告、稳定性、开发者回复和海外付费争议。")
        gaps = channel_config.get("known_gaps", [])
        if gaps:
            lines.append(f"- 当前最高优先级缺口：{gaps[0].get('gap')}。")
        lines.append("")
        return lines
    if channel_config.get("id") in SEARCH_INDEX_CHANNELS:
        gaps = channel_config.get("known_gaps", [])
        lines = [
            "- 继续补齐同一批关键词在 7/30/90 天或平台默认周期下的可比指数，避免不同周期混算。",
            "- 将高指数词回填到社区/应用市场补采，验证是否真的有原文痛点、强情绪和凑合方案。",
            "- 将低指数但社区强痛点的词保留为访谈和定向获客词，不因指数低直接否定。",
            "- 输出内容/投放实验时明确标注：指数只代表热度，不代表授权可行性或付费意愿。",
        ]
        if gaps:
            lines.append(f"- 当前最高优先级缺口：{gaps[0].get('gap')}。")
        lines.append("")
        return lines
    gaps = channel_config.get("known_gaps", [])
    lines = [
        "- 优先补抓竞品词和强信号词，确保 A/B/N 线索都有覆盖。",
        "- 对强情绪和已付费线索补二级回复或访谈，确认付费金额、部署偏好和封号顾虑。",
        "- 把噪声词保留为投放/SEO 避坑，不用于正向规模判断。",
    ]
    if gaps:
        lines.append(f"- 当前最高优先级缺口：{gaps[0].get('gap')}。")
    lines.append("")
    return lines


def analyze_scenario(root: Path, scenario_id: str) -> list[Path]:
    require_keyword_approval(root, scenario_id, operation="analyze evidence")
    evidence_path = root / "data" / "normalized" / scenario_id / "evidence.jsonl"
    rows = read_jsonl(evidence_path)
    if not rows:
        raise FileNotFoundError(f"未找到标准化线索文件：{evidence_path}")
    scenario_path = root / "scenarios" / f"{scenario_id}.json"
    scenario = read_json(scenario_path) if scenario_path.exists() else {"name": scenario_id}
    channel_queries: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        channel = str(row.get("channel") or "").strip()
        if channel:
            channel_queries[channel].add(str(row.get("query") or ""))
    for channel in scenario.get("channels") or []:
        channel_queries.setdefault(str(channel), set())
    for channel, queries in channel_queries.items():
        require_keyword_approval(root, scenario_id, channel, operation="analyze evidence", keywords=queries)
    keyword_matrix = _read_json_if_exists(root / "keyword_matrices" / f"{scenario_id}.json")
    acceptance = _read_json_if_exists(root / "acceptance" / f"{scenario_id}.json")
    out_dir = root / "analysis" / scenario_id
    out_dir.mkdir(parents=True, exist_ok=True)

    paths: list[Path] = []
    channel_groups: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        channel_groups[row.get("channel", "unknown")].append(row)
    planned_channels = _planned_channels(scenario, channel_groups)

    summary_lines = [
        f"# 场景汇总：{scenario.get('name', scenario_id)}",
        "",
        f"- 场景标识：`{scenario_id}`",
        f"- 线索条数：{len(rows)}",
        f"- 计划渠道：{', '.join(_channel_label(channel) for channel in planned_channels) or '未配置'}",
        f"- 已采集渠道：{', '.join(_channel_label(channel) for channel in sorted(channel_groups)) or '无'}",
        "",
    ]
    summary_lines += _decision_summary_md(rows, acceptance, planned_channels)
    if scenario.get("validation_targets"):
        summary_lines += ["## 验证目标", ""]
        summary_lines.extend(f"- {target}" for target in scenario.get("validation_targets", []))
        summary_lines.append("")
    summary_lines += ["## 总体验收状态", ""]
    summary_lines += _acceptance_md(rows, acceptance)
    summary_lines += _channel_completion_md(planned_channels, channel_groups, acceptance)
    summary_lines += _search_index_rollup_md(planned_channels, channel_groups)
    appstore_config = _read_json_if_exists(root / "channels" / "appstore.json")
    summary_lines += _scenario_appstore_market_summary_md(channel_groups.get("appstore", []), appstore_config)
    summary_lines += _decision_questions_md(rows)
    summary_lines += _platform_completion_md(rows)
    summary_lines += _platform_opportunity_md(rows)
    summary_lines += _platform_channel_followup_md(planned_channels, channel_groups)
    summary_lines += _latest_delta_reports_md(root, scenario_id)
    summary_lines += ["## 全局关键词矩阵", ""]
    summary_lines += _keyword_matrix_md(keyword_matrix)
    summary_lines += _validation_md(rows)
    summary_lines += _persona_priority_md(rows)
    summary_lines += _scene_priority_md(rows)
    summary_lines += _hypothesis_summary_md(scenario, rows)
    summary_lines += ["## 线索分布摘要", ""]
    summary_lines += _counter_md("按渠道统计", Counter(row.get("channel") for row in rows), CHANNEL_LABELS, level=3)
    summary_lines += _counter_md("按线索类型统计", Counter(row.get("record_type", "post") for row in rows), RECORD_TYPE_LABELS, level=3)
    summary_lines += _record_type_legend_md()
    summary_lines += _counter_md("按平台统计", Counter(row.get("primary_platform", "unknown") for row in rows), PLATFORM_LABELS, level=3)
    summary_lines += _counter_md("按平台置信度统计", Counter(row.get("platform_confidence", "unknown") for row in rows), PLATFORM_CONFIDENCE_LABELS, level=3)
    summary_lines += _counter_md("按置信度统计", Counter(row.get("confidence") for row in rows), CONFIDENCE_LABELS, level=3)
    summary_lines += _counter_md("按证据角色统计", Counter(row.get("evidence_role", "support") for row in rows), EVIDENCE_ROLE_LABELS, level=3)
    summary_lines += _counter_md("按来源质量统计", Counter(row.get("source_quality", "unknown") for row in rows), SOURCE_QUALITY_LABELS, level=3)
    summary_lines += _counter_md("按痛点维度统计", Counter(row.get("pain_dimension") for row in rows), PAIN_DIMENSION_LABELS, level=3)
    summary_lines += _counter_md("按信号强度统计", Counter(row.get("signal_strength") for row in rows), SIGNAL_LABELS, level=3)
    summary_lines += ["## 全局缺口摘要", ""]
    global_gap_lines = []
    for channel in planned_channels:
        channel_rows = channel_groups.get(channel, [])
        channel_config = _read_json_if_exists(root / "channels" / f"{channel}.json")
        if not channel_rows:
            global_gap_lines.append(f"- {_channel_label(channel)}：渠道尚未采集（P0）")
        channel_gaps = _acceptance_failures(channel_rows, acceptance, channel)
        channel_gaps.extend(channel_config.get("known_gaps", []))
        for gap in channel_gaps:
            global_gap_lines.append(f"- {_channel_label(channel)}：{gap.get('gap')}（{gap.get('priority', 'P1')}）")
    summary_lines.extend(global_gap_lines or ["- 当前没有全局阻断缺口。"])
    summary_lines.append("")
    summary_lines += _summary_next_steps_md(rows, acceptance, planned_channels, channel_groups)
    summary_path = out_dir / "scenario-summary.md"
    summary_path.write_text("\n".join(summary_lines), encoding="utf-8")
    paths.append(summary_path)

    for channel in planned_channels:
        channel_rows = channel_groups.get(channel, [])
        channel_config = _read_json_if_exists(root / "channels" / f"{channel}.json")
        lines = [
            f"# 渠道分析：{_channel_label(channel)}",
            "",
            f"- 场景标识：`{scenario_id}`",
            f"- 线索条数：{len(channel_rows)}",
            "",
        ]
        validation_targets = channel_config.get("validation_targets") or []
        if validation_targets:
            lines += ["## 渠道验证目标", ""]
            lines.extend(f"- {target}" for target in validation_targets)
            lines.append("")
        lines += ["## 本渠道关键词矩阵", ""]
        lines += _keyword_matrix_md(keyword_matrix, channel, include_english=channel in {"reddit", "google-trends"})
        lines += ["## 抓取方案", ""]
        lines += _crawl_plan_md(channel_config)
        lines += ["## 抓取范围与完成情况", ""]
        lines += _acceptance_md(channel_rows, acceptance, channel)
        lines += ["## 线索分布", ""]
        lines += _counter_md("按置信度统计", Counter(row.get("confidence") for row in channel_rows), CONFIDENCE_LABELS, level=3)
        lines += _counter_md("按线索类型统计", Counter(row.get("record_type", "post") for row in channel_rows), RECORD_TYPE_LABELS, level=3)
        lines += _record_type_legend_md()
        lines += _counter_md("按平台统计", Counter(row.get("primary_platform", "unknown") for row in channel_rows), PLATFORM_LABELS, level=3)
        lines += _counter_md("按平台置信度统计", Counter(row.get("platform_confidence", "unknown") for row in channel_rows), PLATFORM_CONFIDENCE_LABELS, level=3)
        lines += _counter_md("按证据角色统计", Counter(row.get("evidence_role", "support") for row in channel_rows), EVIDENCE_ROLE_LABELS, level=3)
        lines += _counter_md("按来源质量统计", Counter(row.get("source_quality", "unknown") for row in channel_rows), SOURCE_QUALITY_LABELS, level=3)
        lines += _counter_md("按痛点维度统计", Counter(row.get("pain_dimension") for row in channel_rows), PAIN_DIMENSION_LABELS, level=3)
        lines += _counter_md("按信号强度统计", Counter(row.get("signal_strength") for row in channel_rows), SIGNAL_LABELS, level=3)
        lines += _evidence_table(sorted(channel_rows, key=_evidence_sort_key), limit=30)
        lines += ["## 渠道结论", ""]
        lines += _channel_conclusion_md(channel_rows, channel_config)
        lines += ["## 本渠道缺口", ""]
        lines += _gap_md(channel_rows, channel_config, acceptance, channel)
        lines += ["## 下一步", ""]
        lines += _next_steps_md(channel_rows, channel_config)
        channel_path = out_dir / f"channel-{channel}.md"
        channel_path.write_text("\n".join(lines), encoding="utf-8")
        paths.append(channel_path)
    return paths
