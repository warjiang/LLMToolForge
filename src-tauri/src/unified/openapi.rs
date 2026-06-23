//! OpenAPI 3.1 spec and an embedded Redoc documentation page.

use axum::response::{Html, IntoResponse, Response};
use serde_json::{json, Value};

use super::http::Ctx;

pub async fn spec(state: Ctx) -> Response {
    let ctx = state.0;
    let models: Vec<String> = {
        let shared = ctx.shared.read().await;
        let mut m: Vec<String> = shared.routes.keys().cloned().collect();
        m.sort();
        m
    };
    axum::Json(build_spec(&models)).into_response()
}

pub async fn docs() -> Response {
    Html(REDOC_HTML).into_response()
}

/// Build the OpenAPI document, listing currently-exposed models as the enum for
/// the `model` field so generated clients see real options.
pub fn build_spec(models: &[String]) -> Value {
    let model_schema = if models.is_empty() {
        json!({ "type": "string", "description": "暴露的模型 id，形如 {provider}/{model}" })
    } else {
        json!({
            "type": "string",
            "description": "暴露的模型 id，形如 {provider}/{model}",
            "enum": models,
        })
    };

    json!({
        "openapi": "3.1.0",
        "info": {
            "title": "LLMToolForge Unified API",
            "version": "1.0.0",
            "description": "本地统一模型网关。OpenAI 兼容端点（/v1/models、/v1/chat/completions）供 Codex 与通用 agent 使用；Anthropic 兼容端点（/v1/messages）供 Claude Code 使用。所有请求按 model 路由到已接入的上游 provider。"
        },
        "servers": [{ "url": "/", "description": "本地服务" }],
        "security": [{ "bearerAuth": [] }],
        "components": {
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "description": "可选。若在应用内设置了本地 API Key，则需在 Authorization 头携带 Bearer <key>（Anthropic 客户端也可用 x-api-key）。"
                }
            },
            "schemas": {
                "Model": model_schema,
                "ChatMessage": {
                    "type": "object",
                    "required": ["role", "content"],
                    "properties": {
                        "role": { "type": "string", "enum": ["system", "user", "assistant", "tool"] },
                        "content": {}
                    }
                },
                "ChatCompletionRequest": {
                    "type": "object",
                    "required": ["model", "messages"],
                    "properties": {
                        "model": { "$ref": "#/components/schemas/Model" },
                        "messages": { "type": "array", "items": { "$ref": "#/components/schemas/ChatMessage" } },
                        "temperature": { "type": "number" },
                        "top_p": { "type": "number" },
                        "max_tokens": { "type": "integer" },
                        "stream": { "type": "boolean", "default": false },
                        "tools": { "type": "array", "items": { "type": "object" } },
                        "tool_choice": {}
                    }
                },
                "AnthropicMessageRequest": {
                    "type": "object",
                    "required": ["model", "messages", "max_tokens"],
                    "properties": {
                        "model": { "$ref": "#/components/schemas/Model" },
                        "system": {},
                        "messages": { "type": "array", "items": { "type": "object" } },
                        "max_tokens": { "type": "integer" },
                        "temperature": { "type": "number" },
                        "top_p": { "type": "number" },
                        "stop_sequences": { "type": "array", "items": { "type": "string" } },
                        "stream": { "type": "boolean", "default": false },
                        "tools": { "type": "array", "items": { "type": "object" } },
                        "tool_choice": {}
                    }
                },
                "Error": {
                    "type": "object",
                    "properties": {
                        "error": {
                            "type": "object",
                            "properties": {
                                "message": { "type": "string" },
                                "type": { "type": "string" },
                                "code": { "type": "integer" }
                            }
                        }
                    }
                }
            }
        },
        "paths": {
            "/v1/models": {
                "get": {
                    "summary": "列出已暴露的模型",
                    "operationId": "listModels",
                    "responses": {
                        "200": {
                            "description": "OpenAI 兼容的模型列表",
                            "content": { "application/json": { "schema": {
                                "type": "object",
                                "properties": {
                                    "object": { "type": "string" },
                                    "data": { "type": "array", "items": { "type": "object" } }
                                }
                            } } }
                        },
                        "401": { "description": "本地 API Key 校验失败", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } }
                    }
                }
            },
            "/v1/chat/completions": {
                "post": {
                    "summary": "OpenAI 兼容对话补全（支持 SSE 流式）",
                    "operationId": "chatCompletions",
                    "requestBody": {
                        "required": true,
                        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ChatCompletionRequest" } } }
                    },
                    "responses": {
                        "200": {
                            "description": "对话补全结果；当 stream=true 时为 text/event-stream",
                            "content": {
                                "application/json": { "schema": { "type": "object" } },
                                "text/event-stream": { "schema": { "type": "string" } }
                            }
                        },
                        "401": { "description": "未授权", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } },
                        "404": { "description": "模型未找到", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } },
                        "502": { "description": "上游错误", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } }
                    }
                }
            },
            "/v1/images/generations": {
                "post": {
                    "summary": "OpenAI 兼容图像生成",
                    "operationId": "imageGenerations",
                    "requestBody": {
                        "required": true,
                        "content": { "application/json": { "schema": { "type": "object", "required": ["model", "prompt"], "properties": { "model": { "$ref": "#/components/schemas/Model" }, "prompt": { "type": "string" }, "n": { "type": "integer" }, "size": { "type": "string" }, "quality": { "type": "string" }, "style": { "type": "string" } } } } }
                    },
                    "responses": {
                        "200": { "description": "图像生成结果", "content": { "application/json": { "schema": { "type": "object" } } } },
                        "401": { "description": "未授权", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } },
                        "404": { "description": "模型未找到", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } },
                        "502": { "description": "上游错误", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } }
                    }
                }
            },
            "/v1/images/edits": {
                "post": {
                    "summary": "OpenAI 兼容图像编辑（multipart/form-data）",
                    "operationId": "imageEdits",
                    "requestBody": {
                        "required": true,
                        "content": { "multipart/form-data": { "schema": { "type": "object", "required": ["model", "image", "prompt"], "properties": { "model": { "$ref": "#/components/schemas/Model" }, "image": { "type": "string", "format": "binary" }, "prompt": { "type": "string" }, "mask": { "type": "string", "format": "binary" }, "n": { "type": "integer" }, "size": { "type": "string" } } } } }
                    },
                    "responses": {
                        "200": { "description": "图像编辑结果", "content": { "application/json": { "schema": { "type": "object" } } } },
                        "401": { "description": "未授权", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } },
                        "404": { "description": "模型未找到", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } },
                        "502": { "description": "上游错误", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } }
                    }
                }
            },
            "/v1/images/variations": {
                "post": {
                    "summary": "OpenAI 兼容图像变体（multipart/form-data）",
                    "operationId": "imageVariations",
                    "requestBody": {
                        "required": true,
                        "content": { "multipart/form-data": { "schema": { "type": "object", "required": ["model", "image"], "properties": { "model": { "$ref": "#/components/schemas/Model" }, "image": { "type": "string", "format": "binary" }, "n": { "type": "integer" }, "size": { "type": "string" } } } } }
                    },
                    "responses": {
                        "200": { "description": "图像变体结果", "content": { "application/json": { "schema": { "type": "object" } } } },
                        "401": { "description": "未授权", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } },
                        "404": { "description": "模型未找到", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } },
                        "502": { "description": "上游错误", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } }
                    }
                }
            },
            "/v1/messages": {
                "post": {
                    "summary": "Anthropic 兼容消息（供 Claude Code，支持 SSE 流式与工具调用）",
                    "operationId": "anthropicMessages",
                    "requestBody": {
                        "required": true,
                        "content": { "application/json": { "schema": { "$ref": "#/components/schemas/AnthropicMessageRequest" } } }
                    },
                    "responses": {
                        "200": {
                            "description": "Anthropic message 结果；当 stream=true 时为 text/event-stream",
                            "content": {
                                "application/json": { "schema": { "type": "object" } },
                                "text/event-stream": { "schema": { "type": "string" } }
                            }
                        },
                        "401": { "description": "未授权", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } },
                        "404": { "description": "模型未找到", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } },
                        "502": { "description": "上游错误", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Error" } } } }
                    }
                }
            }
        }
    })
}

const REDOC_HTML: &str = r#"<!DOCTYPE html>
<html>
  <head>
    <title>LLMToolForge Unified API</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <redoc spec-url="/openapi.json"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>"#;
