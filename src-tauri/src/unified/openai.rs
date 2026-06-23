//! OpenAI-compatible endpoints: `/v1/models`, `/v1/chat/completions`, and `/v1/images/*`.

use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde_json::{json, Value};

use super::http::{
    self, check_auth, emit_log, json_error, lookup, post_chat, post_path, user_agent, AppCtx, Ctx,
    LogBuilder,
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

/// OpenAI-compatible `POST /v1/images/generations`. Routes by `model` to the
/// upstream and forwards the JSON response verbatim. Always non-streaming.
pub async fn images_generations(
    state: Ctx,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
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

    payload["model"] = Value::String(upstream.real_model.clone());

    let log = LogBuilder::new(
        &model,
        &upstream,
        "openai-image",
        false,
        user_agent(&headers),
    );

    let resp = match post_path(&ctx, &upstream, "images/generations", &payload).await {
        Ok(r) => r,
        Err(e) => {
            let rec = log.finish(502, None, Some(e.to_string()));
            emit_log(&ctx, rec).await;
            return json_error(StatusCode::BAD_GATEWAY, &format!("上游请求失败：{e}"));
        }
    };

    forward_json(&ctx, log, resp).await
}

/// OpenAI-compatible `POST /v1/images/edits` (multipart form-data).
/// The request body is forwarded as-is (with model rewritten) to maintain file boundaries.
pub async fn images_edits(
    state: Ctx,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    images_multipart_generic(&state.0, &headers, body, "edits").await
}

/// OpenAI-compatible `POST /v1/images/variations` (multipart form-data).
pub async fn images_variations(
    state: Ctx,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    images_multipart_generic(&state.0, &headers, body, "variations").await
}

/// Handle image endpoint (edits/variations) that accept multipart form-data.
/// Extract model, rewrite it, then forward as multipart verbatim.
async fn images_multipart_generic(ctx: &AppCtx, headers: &HeaderMap, body: axum::body::Bytes, endpoint: &str) -> Response {
    if let Err(resp) = check_auth(ctx, headers).await {
        return resp;
    }

    // Parse multipart to extract the model.
    let model = extract_multipart_model(&body);
    let model_str = model.as_deref().unwrap_or("");

    if model_str.is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "缺少 model 字段");
    }

    let Some(upstream) = lookup(ctx, model_str).await else {
        return json_error(
            StatusCode::NOT_FOUND,
            &format!("未找到模型：{model_str}（请在应用内确认已暴露该模型）"),
        );
    };

    let log = LogBuilder::new(
        model_str,
        &upstream,
        "openai-image",
        false,
        user_agent(headers),
    );

    // Rewrite the model field in the multipart body.
    let rewritten = rewrite_multipart_model(&body, &upstream.real_model);

    let url = format!("{}/images/{}", upstream.base_url, endpoint);
    let resp = match ctx
        .client
        .post(url)
        .header("Authorization", format!("Bearer {}", upstream.api_key))
        .body(rewritten)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let rec = log.finish(502, None, Some(e.to_string()));
            emit_log(ctx, rec).await;
            return json_error(StatusCode::BAD_GATEWAY, &format!("上游请求失败：{e}"));
        }
    };

    forward_json(ctx, log, resp).await
}

/// Extract the "model" field from a multipart form-data body (best-effort).
/// Returns None if not found; this will fail at the OpenAI layer with a proper error.
fn extract_multipart_model(body: &[u8]) -> Option<String> {
    let s = String::from_utf8_lossy(body);
    // Naive search for `name="model"` followed by the value.
    // Multipart format: Content-Disposition: form-data; name="model"\r\n\r\n{value}
    if let Some(idx) = s.find(r#"name="model""#) {
        let after_header = &s[idx + 12..]; // len of 'name="model"' is 12
        if let Some(end_headers) = after_header.find("\r\n\r\n") {
            let value_start = end_headers + 4;
            if let Some(value_end) = after_header[value_start..].find("\r\n") {
                let value = &after_header[value_start..value_start + value_end];
                return Some(value.to_string());
            }
        }
    }
    None
}

/// Rewrite the "model" field in a multipart form-data body.
/// Best-effort replacement; the server will error if rewrite fails.
fn rewrite_multipart_model(body: &[u8], new_model: &str) -> Vec<u8> {
    let s = String::from_utf8_lossy(body);
    if let Some(idx) = s.find(r#"name="model""#) {
        let after_header = &s[idx + 12..];
        if let Some(end_headers) = after_header.find("\r\n\r\n") {
            let value_start = end_headers + 4;
            if let Some(value_end) = after_header[value_start..].find("\r\n") {
                let prefix = &s[..idx + 12 + end_headers + 4];
                let suffix = &s[idx + 12 + value_start + value_end..];
                let mut result = prefix.to_string();
                result.push_str(new_model);
                result.push_str(suffix);
                return result.into_bytes();
            }
        }
    }
    // If rewrite fails, return the original body unchanged; let the server handle it.
    body.to_vec()
}
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
