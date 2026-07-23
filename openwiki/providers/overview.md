---
type: System
title: Providers and Unified API Gateway
description: LLM provider configuration (Volcengine, OpenAI-compatible gateways, manual keys), model capability detection, and the local Unified API gateway exposing models through OpenAI- and Anthropic-compatible endpoints.
tags: [providers, unified-api, gateway, models, volcengine, openai, anthropic]
---

# Providers and Unified API Gateway

LLMToolForge connects to multiple LLM providers and exposes them through a local Unified API gateway. This lets any tool that speaks the OpenAI or Anthropic API use connected models without per-tool API key configuration.

## Provider Types

### Volcengine (火山引擎)

Configured with AK/SK credentials. On connection, the app automatically fetches the account's enabled models (inference endpoints) and Ark API keys. Models are categorized by capabilities: context window, function calling, multimodal, etc.

**Implementation**: [`/src/lib/providers/volcengine/`](/src/lib/providers/volcengine/)  
**UI**: [`/src/pages/providers/VolcengineProviders.tsx`](/src/pages/providers/VolcengineProviders.tsx), [`/src/pages/providers/VolcCredentialDialog.tsx`](/src/pages/providers/VolcCredentialDialog.tsx)  
**Request signing**: [`/src/lib/volc/sign.ts`](/src/lib/volc/sign.ts)

### New API (OpenAI-compatible Gateway)

A generic OpenAI-compatible gateway. Enter a Base URL and API Key; the app calls `/v1/models` to discover available models.

**Implementation**: [`/src/lib/providers/openai-compatible/`](/src/lib/providers/openai-compatible/)  
**UI**: [`/src/pages/providers/GatewayProviders.tsx`](/src/pages/providers/GatewayProviders.tsx), [`/src/pages/providers/GatewayConnectionDialog.tsx`](/src/pages/providers/GatewayConnectionDialog.tsx)

### LiteLLM

An OpenAI-compatible proxy. Same discovery mechanism as New API — enter Base URL + API Key, models are fetched from `/v1/models`.

### Manual API Keys

For providers without auto-discovery. Configure a name, provider label, API key, optional base URL, and manually specify model IDs. A free-form **note/memo field** was added in PR #64 for annotating endpoints.

**UI**: [`/src/pages/providers/ManualKeyProviders.tsx`](/src/pages/providers/ManualKeyProviders.tsx)  
**Dialog**: [`/src/pages/api-keys/ApiKeyDialog.tsx`](/src/pages/api-keys/ApiKeyDialog.tsx)

## Model Capability Detection

The app detects model capabilities from provider metadata when available. For manual/gateway connections without metadata, a conservative **name-based heuristic** is used:

| Capability | Detection Method | Source |
|---|---|---|
| Vision (image input) | `isVisionModel(id, name)` — substring + boundary matching | [`/src/lib/providers/capabilities.ts`](/src/lib/providers/capabilities.ts) |
| Image generation | `isImageGenerationModel(model)` — tags, modalities, name patterns | [`/src/lib/providers/capabilities.ts`](/src/lib/providers/capabilities.ts) |
| Video generation | `isVideoGenerationModel(model)` — tags, modalities, name patterns | [`/src/lib/providers/capabilities.ts`](/src/lib/providers/capabilities.ts) |
| Function calling | From provider metadata | Provider-specific implementations |

The vision heuristic has two tiers: `VISION_SUBSTRINGS` (safe as plain substrings, e.g., "vision", "multimodal", "llava") and `VISION_BOUNDED` (short/ambiguous tokens that must sit on word boundaries, e.g., "vl", "omni", "gpt-4o"). This keeps false positives low for manual connections.

Users can also **force-tag models as vision-capable** in the Unified API configuration.

## Unified API Gateway

The Unified API is a local HTTP server that exposes all connected models through standard API endpoints. It runs as a **[sidecar binary](/openwiki/architecture/overview.md)** (Portkey gateway) managed by the Rust backend. Agents use it for all model calls (both [in-WebView Pi and external AAP agents](/openwiki/agent/overview.md)).

### Architecture

```
External Tool (Codex, Claude Code, OpenAI SDK)
        │
        ▼
http://127.0.0.1:{port}/v1
        │
        ▼
┌─────────────────────────────┐
│  Portkey Gateway (sidecar)  │
│  port 4141 (configurable)    │
│                             │
│  Routing table:             │
│  volcengine/doubao → Ark   │
│  my-gateway/gpt-4o → NewAPI│
└─────────────────────────────┘
        │
        ▼
 Upstream Providers (Volcengine, OpenAI, etc.)
```

### Endpoints

| Endpoint | Protocol | Purpose |
|---|---|---|
| `GET /v1/models` | OpenAI | List all exposed models |
| `POST /v1/chat/completions` | OpenAI | Chat completions (streaming + non-streaming) |
| `POST /v1/messages` | Anthropic | Messages API with request/response translation (for Claude Code) |
| `GET /openapi.json` | — | OpenAPI 3.1 spec |
| `GET /docs` | — | Redoc interactive documentation |
| `GET /health` | — | Health check |

Model IDs follow the pattern `{connectionName}/{model}`, e.g., `volcengine/doubao-pro-32k`. Users can disable individual models via toggle switches.

### Gateway Management

**Rust supervisor**: [`/src-tauri/src/unified/mod.rs`](/src-tauri/src/unified/mod.rs)  
**Frontend bridge**: [`/src/lib/unifiedApi.ts`](/src/lib/unifiedApi.ts)  
**Frontend store**: [`/src/store/unified.ts`](/src/store/unified.ts)  
**UI page**: [`/src/pages/unified/UnifiedApiPage.tsx`](/src/pages/unified/UnifiedApiPage.tsx)

Tauri commands for gateway lifecycle:
- `unified_api_start` — Start the gateway with routing table
- `unified_api_stop` — Stop the gateway
- `unified_api_status` — Get current status (running, port, model count)
- `unified_api_push_routing` — Update routing table (model → upstream mapping)
- `unified_api_stats` — Get call statistics

### Authentication

The gateway supports an **optional local API key**. When configured, clients must present it as a Bearer token. When empty, no authentication is required (relying on `127.0.0.1` loopback binding for security).

### Call Monitoring

The **Monitor Panel** ([`/src/pages/unified/MonitorPanel.tsx`](/src/pages/unified/MonitorPanel.tsx)) provides real-time observability:

- **Live call log**: Streaming view of all requests through the gateway
- **Success rate**: Percentage of successful calls
- **P95 latency**: 95th percentile response time
- **Token statistics**: Total input/output tokens
- **SVG charts**: Visual representations of usage patterns
- **Filtering**: Filter by model, status, time range
- **Export**: JSON and CSV export of call records
- **Call details**: Request/response body inspection (with manual "clear bodies" button for privacy)

The call log ring buffer is maintained in the Rust layer. The frontend receives events via a custom event channel (`unified://call-log`).

### Integration Guide

The Unified API page includes a built-in **Integration Guide** ([`/src/pages/unified/IntegrationGuide.tsx`](/src/pages/unified/IntegrationGuide.tsx)) with one-click copy examples for:

- OpenAI Python SDK
- OpenAI Node.js SDK
- curl
- Codex configuration
- Claude Code configuration

### OpenAPI Spec

The gateway exposes an OpenAPI 3.1 specification at `GET /openapi.json`. The static source is at [`/docs/unified-api/openapi.json`](/docs/unified-api/openapi.json).
