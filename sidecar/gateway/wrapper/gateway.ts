/**
 * LLMToolForge unified gateway sidecar — entry point.
 *
 * Wraps the vendored Portkey gateway (`../portkey/src/index.ts`) with:
 *   - local API key auth,
 *   - a `/v1/models` endpoint backed by the app's routing table,
 *   - resolution of exposed model ids (`{connName}/{model}`) to the real upstream
 *     (provider + custom host + real key + real model), injected as Portkey
 *     headers so upstream credentials never reach the client,
 *   - an Anthropic <-> OpenAI bridge for `/v1/messages` (Claude Code), since
 *     Portkey cannot translate Anthropic requests to OpenAI-compatible upstreams,
 *   - structured call logging emitted to stdout for the Tauri supervisor.
 *
 * Everything else (chat/completions, embeddings, images, ...) is delegated to
 * Portkey, which performs the provider-specific translation.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';

import portkeyApp from '../portkey/src/index.ts';
import { initConfig, getConfig, lookupRoute, type RouteEntry } from './config.ts';
import {
  emitCallLog,
  emitDiagnostic,
  initDiskLog,
  usageFromJson,
  truncateBody,
  MAX_BODY_CHARS,
  UsageParser,
  type CallLog,
} from './logging.ts';
import {
  anthropicToOpenAI,
  openAIToAnthropicMessage,
  AnthropicStreamTranslator,
} from './anthropic.ts';
import { buildSpec, REDOC_HTML } from './openapi.ts';
import {
  formatGatewayDiagnostic,
  streamLogStatus,
  protocolFor,
  ResponsesUsageParser,
  classifyResponsesOutcome,
  responsesStreamErrorFrames,
  type StreamOutcome,
} from './observability.ts';

// --- args / env ------------------------------------------------------------

function parseArgs(): { port: number; configPath?: string } {
  const args = process.argv.slice(2);
  let port = Number(process.env.GATEWAY_PORT) || 4141;
  let configPath = process.env.GATEWAY_CONFIG_FILE || undefined;
  for (const a of args) {
    if (a.startsWith('--port=')) port = parseInt(a.slice('--port='.length), 10);
    else if (a.startsWith('--config=')) configPath = a.slice('--config='.length);
  }
  return { port, configPath };
}

const { port, configPath } = parseArgs();
initConfig(configPath);
initDiskLog(configPath);

// Mirror the sidecar's own diagnostics (banners, config errors) and — more
// importantly — Portkey's `console.error`/`console.warn` lines (`retryRequest`,
// `tryTargetsRecursively`, `Failed to parse JSON`) into the rolling JSONL log,
// so a failure's cause is inspectable on disk alongside the call it broke.
// stderr forwarding is preserved so `pnpm tauri:dev` output is unchanged.
function installDiagnosticCapture(): void {
  const wrap = (orig: (...a: unknown[]) => void) =>
    (...args: unknown[]): void => {
      try {
        const diagnostic = formatGatewayDiagnostic(args);
        if (diagnostic) emitDiagnostic(diagnostic);
      } catch {
        // never let capture break logging
      }
      orig(...args);
    };
  console.error = wrap(console.error.bind(console));
  console.warn = wrap(console.warn.bind(console));
}

installDiagnosticCapture();

// --- helpers ---------------------------------------------------------------

function jsonError(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        message,
        type: 'unified_api_error',
        code: status,
      },
    }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}

function bearer(c: Context): string | undefined {
  const raw = c.req.header('authorization');
  if (!raw) return undefined;
  const m = /^bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : undefined;
}

/** Returns an error Response when the local key is required and invalid. */
function checkAuth(c: Context): Response | undefined {
  const expected = getConfig().localKey;
  if (!expected) return undefined;
  const presented = bearer(c) ?? c.req.header('x-api-key') ?? undefined;
  if (presented === expected) return undefined;
  return jsonError(401, '无效的本地 API Key');
}

function userAgent(c: Context): string | undefined {
  return c.req.header('user-agent') ?? undefined;
}

function nowMs(): number {
  return Date.now();
}

/** Build the headers used when delegating to the Portkey app. */
function portkeyHeaders(c: Context, route: RouteEntry): Headers {
  const headers = new Headers(c.req.raw.headers);
  headers.delete('x-api-key');
  headers.delete('content-length');
  headers.delete('host');
  headers.delete('accept-encoding');
  headers.set('x-portkey-provider', route.portkeyProvider ?? 'openai');
  headers.set('x-portkey-custom-host', route.baseUrl);
  headers.set('authorization', `Bearer ${route.apiKey}`);
  return headers;
}

interface LogMeta {
  exposedModel: string;
  route: RouteEntry;
  protocol: string;
  stream: boolean;
  userAgent?: string;
  ts: number;
  started: number;
  /** Upstream request body (the real model call), captured for the monitor UI. */
  requestBody?: string;
}

function finishLog(
  meta: LogMeta,
  status: number,
  tokens: { prompt?: number; completion?: number; total?: number } | undefined,
  error: string | undefined,
  responseBody?: string
): void {
  const rec: CallLog = {
    ts: meta.ts,
    exposedModel: meta.exposedModel,
    realModel: meta.route.realModel,
    provider: meta.route.provider,
    protocol: meta.protocol,
    stream: meta.stream,
    status,
    durationMs: nowMs() - meta.started,
    promptTokens: tokens?.prompt,
    completionTokens: tokens?.completion,
    totalTokens: tokens?.total,
    error,
    userAgent: meta.userAgent,
    requestBody: truncateBody(meta.requestBody),
    responseBody: truncateBody(responseBody),
  };
  emitCallLog(rec);
}

/** Accumulate streamed text up to the body cap without unbounded growth. */
class BodyAccumulator {
  private buf = '';
  push(chunk: string): void {
    if (this.buf.length >= MAX_BODY_CHARS) return;
    this.buf += chunk;
  }
  value(): string {
    return this.buf;
  }
}

/**
 * When a stream we already answered with `200 text/event-stream` breaks
 * mid-flight, the client (pi-ai via the plugin-http shim) would otherwise see a
 * torn stream — which surfaces as an opaque Tauri `resource id ... is invalid`
 * error rather than the real cause. Emit a proper SSE error terminator so the
 * client parses a structured error and reports it verbatim.
 */
function openAIStreamErrorFrames(message: string): string[] {
  const err = JSON.stringify({
    error: { message, type: 'upstream_stream_error', code: 502 },
  });
  return [`data: ${err}\n\n`, 'data: [DONE]\n\n'];
}

/** Anthropic Messages SSE variant of {@link openAIStreamErrorFrames}. */
function anthropicStreamErrorFrames(message: string): string[] {
  const err = JSON.stringify({
    type: 'error',
    error: { type: 'api_error', message },
  });
  return [`event: error\ndata: ${err}\n\n`];
}

/**
 * Body to persist for a stream that ended in error: keep whatever upstream text
 * was seen, but annotate the (common) empty case so the on-disk record is not
 * dropped as empty and the break is still diagnosable.
 */
function streamErrorBody(seen: string, error: string | undefined): string {
  if (!error) return seen;
  if (seen) return seen;
  return `[no upstream body received before stream error: ${error}]`;
}

// --- app -------------------------------------------------------------------

const app = new Hono();

app.get('/', (c) => c.text('LLMToolForge unified gateway (Portkey-powered)'));
app.get('/health', (c) => c.json({ ok: true }));

// Unauthenticated API documentation (linked from the app's integration guide).
app.get('/openapi.json', (c) => {
  const models = Object.keys(getConfig().routes).sort();
  return c.json(buildSpec(models) as Record<string, unknown>);
});
app.get('/docs', (c) => c.html(REDOC_HTML));

// Model listing from the app routing table.
app.get('/v1/models', (c) => {
  const authErr = checkAuth(c);
  if (authErr) return authErr;
  const created = Math.floor(Date.now() / 1000);
  const routes = getConfig().routes;
  const data = Object.entries(routes)
    .map(([id, r]) => ({
      id,
      object: 'model',
      created,
      owned_by: r.provider,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return c.json({ object: 'list', data });
});

// Anthropic Messages endpoint (Claude Code) — translated to OpenAI and delegated.
app.post('/v1/messages', async (c) => {
  const authErr = checkAuth(c);
  if (authErr) return authErr;

  let payload: any;
  try {
    payload = await c.req.json();
  } catch (e) {
    return jsonError(400, `请求体不是合法 JSON：${(e as Error).message}`);
  }

  const exposedModel = typeof payload?.model === 'string' ? payload.model : '';
  if (!exposedModel) return jsonError(400, '缺少 model 字段');

  const route = lookupRoute(exposedModel);
  if (!route) {
    return jsonError(404, `未找到模型：${exposedModel}（请在应用内确认已暴露该模型）`);
  }

  const stream = payload?.stream === true;
  const openaiBody = anthropicToOpenAI(payload, route.realModel, stream);

  const meta: LogMeta = {
    exposedModel,
    route,
    protocol: 'anthropic',
    stream,
    userAgent: userAgent(c),
    ts: nowMs(),
    started: nowMs(),
    requestBody: JSON.stringify(openaiBody),
  };

  const headers = portkeyHeaders(c, route);
  headers.set('content-type', 'application/json');
  headers.set('accept', stream ? 'text/event-stream' : 'application/json');

  let upstream: Response;
  try {
    upstream = await portkeyApp.fetch(
      new Request('http://gateway/v1/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify(openaiBody),
      })
    );
  } catch (e) {
    finishLog(meta, 502, undefined, (e as Error).message);
    return jsonError(502, `上游请求失败：${(e as Error).message}`);
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    finishLog(meta, upstream.status, undefined, `HTTP ${upstream.status}`, text);
    return new Response(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (stream && upstream.body) {
    const translator = new AnthropicStreamTranslator(exposedModel);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = upstream.body.getReader();
    const respAcc = new BodyAccumulator();
    let logged = false;
    const done = (outcome: StreamOutcome, error?: string) => {
      if (logged) return;
      logged = true;
      finishLog(
        meta,
        streamLogStatus(200, outcome),
        translator.tokens(),
        error,
        streamErrorBody(respAcc.value(), error)
      );
    };
    const out = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (;;) {
            const { done: rdone, value } = await reader.read();
            if (rdone) {
              for (const frame of translator.finish())
                controller.enqueue(encoder.encode(frame));
              done('success');
              controller.close();
              return;
            }
            const chunk = decoder.decode(value, { stream: true });
            respAcc.push(chunk);
            for (const frame of translator.feed(chunk))
              controller.enqueue(encoder.encode(frame));
            // Upstream connections (via Portkey) may stay open after `[DONE]`;
            // close as soon as the translator has emitted its terminal frames.
            if (translator.isFinished()) {
              done('success');
              controller.close();
              reader.cancel().catch(() => {});
              return;
            }
          }
        } catch (e) {
          const msg = (e as Error).message;
          // Surface the break as a structured Anthropic SSE error, then close
          // out the message cleanly so the client sees a real error instead of
          // a truncated stream.
          for (const frame of anthropicStreamErrorFrames(msg))
            controller.enqueue(encoder.encode(frame));
          for (const frame of translator.finish())
            controller.enqueue(encoder.encode(frame));
          done('upstream_error', msg);
          controller.close();
        }
      },
      cancel(reason) {
        reader.cancel(reason).catch(() => {});
        done('client_cancelled', 'client closed');
      },
    });
    return new Response(out, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  }

  // Non-streaming: translate the OpenAI response into an Anthropic message.
  const text = await upstream.text();
  let openai: any;
  try {
    openai = JSON.parse(text);
  } catch (e) {
    finishLog(meta, 502, undefined, (e as Error).message, text);
    return jsonError(502, `上游响应解析失败：${(e as Error).message}`);
  }
  finishLog(meta, 200, usageFromJson(openai), undefined, text);
  return new Response(JSON.stringify(openAIToAnthropicMessage(openai, exposedModel)), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});

// Generic OpenAI-compatible endpoints — resolve model, rewrite, delegate to Portkey.
app.post('/v1/*', async (c) => {
  const authErr = checkAuth(c);
  if (authErr) return authErr;

  const url = new URL(c.req.url);
  const path = url.pathname; // e.g. /v1/chat/completions
  const protocol = protocolFor(path);
  const contentType = c.req.header('content-type') ?? '';

  // Multipart endpoints (image edits/variations): rewrite the model form field.
  if (contentType.includes('multipart/form-data')) {
    return handleMultipart(c, path, protocol);
  }

  let payload: any;
  try {
    payload = await c.req.json();
  } catch (e) {
    return jsonError(400, `请求体不是合法 JSON：${(e as Error).message}`);
  }

  const exposedModel = typeof payload?.model === 'string' ? payload.model : '';
  if (!exposedModel) return jsonError(400, '缺少 model 字段');

  const route = lookupRoute(exposedModel);
  if (!route) {
    return jsonError(404, `未找到模型：${exposedModel}（请在应用内确认已暴露该模型）`);
  }

  const stream = payload?.stream === true;
  payload.model = route.realModel;

  const meta: LogMeta = {
    exposedModel,
    route,
    protocol,
    stream,
    userAgent: userAgent(c),
    ts: nowMs(),
    started: nowMs(),
    requestBody: JSON.stringify(payload),
  };

  const headers = portkeyHeaders(c, route);
  headers.set('content-type', 'application/json');

  let upstream: Response;
  try {
    upstream = await portkeyApp.fetch(
      new Request(`http://gateway${path}${url.search}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })
    );
  } catch (e) {
    finishLog(meta, 502, undefined, (e as Error).message);
    return jsonError(502, `上游请求失败：${(e as Error).message}`);
  }

  return await instrumentResponse(upstream, meta);
});

/** Pass a delegated response back to the client while capturing usage + logging. */
async function instrumentResponse(
  upstream: Response,
  meta: LogMeta
): Promise<Response> {
  const ct = upstream.headers.get('content-type') ?? '';
  const isStream = ct.includes('text/event-stream');
  const isResponses = meta.protocol === 'openai-responses';

  if (isStream && upstream.body) {
    if (isResponses) return instrumentResponsesStream(upstream, meta);
    const parser = new UsageParser();
    const decoder = new TextDecoder();
    const reader = upstream.body.getReader();
    const respAcc = new BodyAccumulator();
    let logged = false;
    const done = (outcome: StreamOutcome, error?: string) => {
      if (logged) return;
      logged = true;
      finishLog(
        meta,
        streamLogStatus(upstream.status, outcome),
        parser.tokens(),
        error,
        streamErrorBody(respAcc.value(), error)
      );
    };
    const out = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done: rdone, value } = await reader.read();
          if (rdone) {
            done('success');
            controller.close();
            return;
          }
          const chunk = decoder.decode(value, { stream: true });
          parser.feed(chunk);
          respAcc.push(chunk);
          controller.enqueue(value);
        } catch (e) {
          const msg = (e as Error).message;
          // The upstream stream broke after we already sent a 200. Emit a
          // structured SSE error terminator so the client parses a real error
          // instead of an opaque torn-stream / invalid-resource failure.
          const encoder = new TextEncoder();
          for (const frame of openAIStreamErrorFrames(msg))
            controller.enqueue(encoder.encode(frame));
          done('upstream_error', msg);
          controller.close();
        }
      },
      cancel(reason) {
        reader.cancel(reason).catch(() => {});
        done('client_cancelled', 'client closed');
      },
    });
    const headers = new Headers(upstream.headers);
    return new Response(out, { status: upstream.status, headers });
  }

  // Non-streaming: read fully, capture usage, then forward verbatim.
  const buf = await upstream.arrayBuffer();
  const bodyText = new TextDecoder().decode(buf);
  let tokens;
  let error: string | undefined;
  try {
    const parsed = JSON.parse(bodyText);
    tokens = isResponses ? usageFromResponsesJson(parsed) : usageFromJson(parsed);
  } catch {
    tokens = undefined;
  }
  if (!upstream.ok) error = `HTTP ${upstream.status}`;
  finishLog(meta, upstream.status, tokens, error, bodyText);
  const headers = new Headers(upstream.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(buf, { status: upstream.status, headers });
}

/** Map a non-streaming Responses JSON body's `usage` block to call-log tokens. */
function usageFromResponsesJson(
  v: any
): { prompt?: number; completion?: number; total?: number } | undefined {
  const u = v?.usage;
  if (!u) return undefined;
  const prompt = typeof u.input_tokens === 'number' ? u.input_tokens : undefined;
  const completion =
    typeof u.output_tokens === 'number' ? u.output_tokens : undefined;
  const total = typeof u.total_tokens === 'number' ? u.total_tokens : undefined;
  if (prompt === undefined && completion === undefined && total === undefined) {
    return undefined;
  }
  return { prompt, completion, total };
}

/**
 * Stream a Responses SSE response back to the client while observing usage and
 * the terminal semantic event.
 *
 * Outcome mapping (design.md "Gateway Observation and Documentation"):
 *   - response.completed        -> success (upstream status)
 *   - response.incomplete       -> 502 + reason/usage (Pi keeps output-limit
 *                                   semantics; not disguised as a net error)
 *   - response.failed / error   -> 502 + diagnostic, even after HTTP 200
 *   - EOF without terminal event -> 502 + truncation diagnostic
 *   - transport break            -> event: error frame + 502 (original message)
 *   - downstream cancellation    -> 499
 *
 * These statuses describe the monitor/log record only; they never rewrite HTTP
 * headers already sent to the client.
 */
function instrumentResponsesStream(
  upstream: Response,
  meta: LogMeta
): Response {
  const parser = new ResponsesUsageParser();
  const decoder = new TextDecoder();
  const reader = upstream.body!.getReader();
  const respAcc = new BodyAccumulator();
  let logged = false;
  const finishSuccessOrTerminal = () => {
    if (logged) return;
    logged = true;
    // Classify the terminal event from the observed body. A completed stream is
    // success; incomplete/failed/absent-terminal is a non-success log outcome.
    const result = classifyResponsesOutcome(respAcc.value());
    const tokens = result.tokens ?? parser.tokens();
    if (result.outcome === 'success') {
      finishLog(meta, upstream.status, tokens, undefined, respAcc.value());
    } else {
      finishLog(
        meta,
        502,
        tokens,
        result.diagnostic,
        streamErrorBody(respAcc.value(), result.diagnostic)
      );
    }
  };
  const finishBroken = (error: string) => {
    if (logged) return;
    logged = true;
    finishLog(meta, 502, parser.tokens(), error, streamErrorBody(respAcc.value(), error));
  };
  const finishCancelled = () => {
    if (logged) return;
    logged = true;
    finishLog(
      meta,
      streamLogStatus(upstream.status, 'client_cancelled'),
      parser.tokens(),
      'client closed',
      streamErrorBody(respAcc.value(), 'client closed')
    );
  };
  const out = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: rdone, value } = await reader.read();
        if (rdone) {
          finishSuccessOrTerminal();
          controller.close();
          return;
        }
        const chunk = decoder.decode(value, { stream: true });
        parser.feed(chunk);
        respAcc.push(chunk);
        controller.enqueue(value);
      } catch (e) {
        const msg = (e as Error).message;
        // Responses clients (Pi SDK) parse a top-level `event: error` frame as a
        // thrown stream error. Emit that instead of tearing the stream down.
        const encoder = new TextEncoder();
        for (const frame of responsesStreamErrorFrames(msg))
          controller.enqueue(encoder.encode(frame));
        finishBroken(msg);
        controller.close();
      }
    },
    cancel(reason) {
      reader.cancel(reason).catch(() => {});
      finishCancelled();
    },
  });
  const headers = new Headers(upstream.headers);
  return new Response(out, { status: upstream.status, headers });
}

/** Multipart image endpoints: extract + rewrite the `model` field, forward as-is. */
async function handleMultipart(
  c: Context,
  path: string,
  protocol: string
): Promise<Response> {
  const buf = new Uint8Array(await c.req.arrayBuffer());
  const text = new TextDecoder('latin1').decode(buf);
  const model = extractMultipartModel(text);
  if (!model) return jsonError(400, '缺少 model 字段');
  const route = lookupRoute(model);
  if (!route) {
    return jsonError(404, `未找到模型：${model}（请在应用内确认已暴露该模型）`);
  }

  const rewritten = rewriteMultipartModel(text, route.realModel);
  const body = new TextEncoder().encode(rewritten);

  const meta: LogMeta = {
    exposedModel: model,
    route,
    protocol,
    stream: false,
    userAgent: userAgent(c),
    ts: nowMs(),
    started: nowMs(),
    requestBody: '[multipart/form-data]',
  };

  const headers = portkeyHeaders(c, route);
  const ct = c.req.header('content-type');
  if (ct) headers.set('content-type', ct);

  let upstream: Response;
  try {
    upstream = await portkeyApp.fetch(
      new Request(`http://gateway${path}`, { method: 'POST', headers, body })
    );
  } catch (e) {
    finishLog(meta, 502, undefined, (e as Error).message);
    return jsonError(502, `上游请求失败：${(e as Error).message}`);
  }
  return await instrumentResponse(upstream, meta);
}

function extractMultipartModel(s: string): string | undefined {
  const idx = s.indexOf('name="model"');
  if (idx === -1) return undefined;
  const after = s.slice(idx + 'name="model"'.length);
  const headerEnd = after.indexOf('\r\n\r\n');
  if (headerEnd === -1) return undefined;
  const valueStart = headerEnd + 4;
  const valueEnd = after.slice(valueStart).indexOf('\r\n');
  if (valueEnd === -1) return undefined;
  return after.slice(valueStart, valueStart + valueEnd);
}

function rewriteMultipartModel(s: string, newModel: string): string {
  const idx = s.indexOf('name="model"');
  if (idx === -1) return s;
  const after = s.slice(idx + 'name="model"'.length);
  const headerEnd = after.indexOf('\r\n\r\n');
  if (headerEnd === -1) return s;
  const valueStart = headerEnd + 4;
  const valueEnd = after.slice(valueStart).indexOf('\r\n');
  if (valueEnd === -1) return s;
  const prefix = s.slice(0, idx + 'name="model"'.length + headerEnd + 4);
  const suffix = s.slice(idx + 'name="model"'.length + valueStart + valueEnd);
  return prefix + newModel + suffix;
}

app.notFound(() => jsonError(404, '未找到该端点'));

// --- serve -----------------------------------------------------------------

const banner = `[gateway] LLMToolForge unified gateway listening on http://127.0.0.1:${port}`;

declare const Bun: any;
if (typeof Bun !== 'undefined' && Bun?.serve) {
  Bun.serve({ port, hostname: '127.0.0.1', idleTimeout: 0, fetch: app.fetch });
  console.error(banner);
} else {
  const { serve } = await import('@hono/node-server');
  serve({ fetch: app.fetch, port, hostname: '127.0.0.1' });
  console.error(banner);
}
