//! OpenAI-compatible endpoints: `/v1/models` and `/v1/chat/completions`.

use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{json, Value};

use super::http::{
    self, check_auth, emit_log, json_error, lookup, post_chat, user_agent, AppCtx, Ctx, LogBuilder,
};

pub async fn list_models(state: Ctx, headers: HeaderMap) -> Response {
    let ctx = state.0;
    if let Err(resp) = check_auth(&ctx, &headers).await {
        return resp;
    }
    let now = super::now_ms() / 1000;
    let data: Vec<Value> = {
        let shared = ctx.shared.read().await;
        let mut ids: Vec<(String, String)> = shared
            .routes
            .iter()
            .map(|(id, up)| (id.clone(), up.provider.clone()))
            .collect();
        ids.sort_by(|a, b| a.0.cmp(&b.0));
        ids.into_iter()
            .map(|(id, provider)| {
                json!({
                    "id": id,
                    "object": "model",
                    "created": now,
                    "owned_by": provider,
                })
            })
            .collect()
    };
    axum::Json(json!({ "object": "list", "data": data })).into_response()
}

pub async fn chat_completions(state: Ctx, headers: HeaderMap, body: axum::body::Bytes) -> Response {
    let ctx = state.0;
    if let Err(resp) = check_auth(&ctx, &headers).await {
        return resp;
    }

    let mut payload: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            return json_error(
                StatusCode::BAD_REQUEST,
                &format!("请求体不是合法 JSON：{e}"),
            )
        }
    };

    let model = payload
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if model.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "缺少 model 字段");
    }

    let Some(upstream) = lookup(&ctx, &model).await else {
        return json_error(
            StatusCode::NOT_FOUND,
            &format!("未找到模型：{model}（请在应用内确认已暴露该模型）"),
        );
    };

    let stream = payload
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // Rewrite the exposed id to the upstream's real model id.
    payload["model"] = Value::String(upstream.real_model.clone());

    let log = LogBuilder::new(
        &model,
        &upstream,
        "openai-chat",
        stream,
        user_agent(&headers),
    );

    let resp = match post_chat(&ctx, &upstream, &payload).await {
        Ok(r) => r,
        Err(e) => {
            let rec = log.finish(502, None, Some(e.to_string()));
            emit_log(&ctx, rec).await;
            return json_error(StatusCode::BAD_GATEWAY, &format!("上游请求失败：{e}"));
        }
    };

    if stream && resp.status().is_success() {
        return http::sse_response(&ctx, log, resp);
    }

    forward_json(&ctx, log, resp).await
}

/// Read a non-streaming upstream response, log usage and forward it verbatim.
async fn forward_json(ctx: &AppCtx, log: LogBuilder, resp: reqwest::Response) -> Response {
    let status = resp.status();
    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            let rec = log.finish(status.as_u16(), None, Some(e.to_string()));
            emit_log(ctx, rec).await;
            return json_error(StatusCode::BAD_GATEWAY, &format!("读取上游响应失败：{e}"));
        }
    };

    let parsed: Option<Value> = serde_json::from_slice(&bytes).ok();
    let tokens = parsed.as_ref().and_then(usage_from_json);
    let error = if status.is_success() {
        None
    } else {
        Some(format!("HTTP {}", status.as_u16()))
    };
    let rec = log.finish(status.as_u16(), tokens, error);
    emit_log(ctx, rec).await;

    Response::builder()
        .status(status)
        .header("Content-Type", "application/json")
        .body(axum::body::Body::from(bytes))
        .unwrap_or_else(|_| json_error(StatusCode::INTERNAL_SERVER_ERROR, "无法构建响应"))
}

pub fn usage_from_json(v: &Value) -> Option<(Option<u64>, Option<u64>, Option<u64>)> {
    let usage = v.get("usage")?;
    let p = usage.get("prompt_tokens").and_then(|x| x.as_u64());
    let c = usage.get("completion_tokens").and_then(|x| x.as_u64());
    let t = usage.get("total_tokens").and_then(|x| x.as_u64());
    if p.is_none() && c.is_none() && t.is_none() {
        None
    } else {
        Some((p, c, t))
    }
}
