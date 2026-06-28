from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


DEFAULT_DIMENSIONS = [
    "accuracy_quality",
    "privacy_compliance",
    "cross_platform",
    "pricing_payment",
    "usability_interaction",
    "stability_performance",
    "missing_feature",
    "noise",
]


@dataclass
class Scenario:
    id: str
    name: str
    description: str = ""
    target_users: list[str] = field(default_factory=list)
    validation_targets: list[str] = field(default_factory=list)
    hypotheses: list[str] = field(default_factory=list)
    channels: list[str] = field(default_factory=list)
    keywords: dict[str, list[str]] = field(default_factory=dict)
    coding: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "target_users": self.target_users,
            "validation_targets": self.validation_targets,
            "hypotheses": self.hypotheses,
            "channels": self.channels,
            "keywords": self.keywords,
            "coding": self.coding or {"dimensions": DEFAULT_DIMENSIONS},
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "Scenario":
        return cls(
            id=data["id"],
            name=data.get("name", data["id"]),
            description=data.get("description", ""),
            target_users=list(data.get("target_users", [])),
            validation_targets=list(data.get("validation_targets", [])),
            hypotheses=list(data.get("hypotheses", [])),
            channels=list(data.get("channels", [])),
            keywords=dict(data.get("keywords", {})),
            coding=dict(data.get("coding", {})),
        )


@dataclass
class RawRecord:
    source_id: str
    title: str
    source_url: str
    record_type: str = "post"
    parent_source_id: str = ""
    comment_id: str = ""
    query: str = ""
    body: str = ""
    comments: list[dict[str, Any]] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)
    captured_at: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "title": self.title,
            "source_url": self.source_url,
            "record_type": self.record_type,
            "parent_source_id": self.parent_source_id,
            "comment_id": self.comment_id,
            "query": self.query,
            "body": self.body,
            "comments": self.comments,
            "metrics": self.metrics,
            "captured_at": self.captured_at,
            "extra": self.extra,
        }


@dataclass
class Evidence:
    evidence_id: str
    scenario_id: str
    channel: str
    record_type: str
    source_id: str
    parent_source_id: str
    comment_id: str
    source_url: str
    captured_at: str
    query: str
    title: str
    quote: str
    comment_signal: str
    comments_count: int
    metrics: dict[str, Any]
    pain_dimension: str
    persona: str
    signal_strength: str
    confidence: str
    evidence_role: str
    validation_targets: list[str]
    source_quality: str
    interpretation: str
    next_step: str
    noise: bool
    tags: list[str]
    primary_platform: str
    platform_confidence: str
    platform_confidence_score: int
    platform_reason: str
    secondary_platforms: list[str]
    raw_run_id: str

    def to_json(self) -> dict[str, Any]:
        return {
            "evidence_id": self.evidence_id,
            "scenario_id": self.scenario_id,
            "channel": self.channel,
            "record_type": self.record_type,
            "source_id": self.source_id,
            "parent_source_id": self.parent_source_id,
            "comment_id": self.comment_id,
            "source_url": self.source_url,
            "captured_at": self.captured_at,
            "query": self.query,
            "title": self.title,
            "quote": self.quote,
            "comment_signal": self.comment_signal,
            "comments_count": self.comments_count,
            "metrics": self.metrics,
            "pain_dimension": self.pain_dimension,
            "persona": self.persona,
            "signal_strength": self.signal_strength,
            "confidence": self.confidence,
            "evidence_level": self.confidence,
            "evidence_role": self.evidence_role,
            "validation_targets": self.validation_targets,
            "source_quality": self.source_quality,
            "interpretation": self.interpretation,
            "next_step": self.next_step,
            "noise": self.noise,
            "tags": self.tags,
            "primary_platform": self.primary_platform,
            "platform_confidence": self.platform_confidence,
            "platform_confidence_score": self.platform_confidence_score,
            "platform_reason": self.platform_reason,
            "secondary_platforms": self.secondary_platforms,
            "raw_run_id": self.raw_run_id,
        }
