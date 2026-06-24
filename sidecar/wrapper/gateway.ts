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
  usageFromJson,
  UsageParser,
  type CallLog,
} from './logging.ts';
import {
  anthropicToOpenAI,
  openAIToAnthropicMessage,
  AnthropicStreamTranslator,
} from './anthropic.ts';
import { buildSpec, REDOC_HTML } from './openapi.ts';

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
}

function finishLog(
  meta: LogMeta,
  status: number,
  tokens: { prompt?: number; completion?: number; total?: number } | undefined,
  error: string | undefined
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
  };
  emitCallLog(rec);
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
    finishLog(meta, upstream.status, undefined, `HTTP ${upstream.status}`);
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
    let logged = false;
    const done = (error?: string) => {
      if (logged) return;
      logged = true;
      finishLog(meta, 200, translator.tokens(), error);
    };
    const out = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (;;) {
            const { done: rdone, value } = await reader.read();
            if (rdone) {
              for (const frame of translator.finish())
                controller.enqueue(encoder.encode(frame));
              done();
              controller.close();
              return;
            }
            for (const frame of translator.feed(decoder.decode(value, { stream: true })))
              controller.enqueue(encoder.encode(frame));
            // Upstream connections (via Portkey) may stay open after `[DONE]`;
            // close as soon as the translator has emitted its terminal frames.
            if (translator.isFinished()) {
              done();
              controller.close();
              reader.cancel().catch(() => {});
              return;
            }
          }
        } catch (e) {
          for (const frame of translator.finish())
            controller.enqueue(encoder.encode(frame));
          done((e as Error).message);
          controller.close();
        }
      },
      cancel(reason) {
        reader.cancel(reason).catch(() => {});
        done('client closed');
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
    finishLog(meta, 502, undefined, (e as Error).message);
    return jsonError(502, `上游响应解析失败：${(e as Error).message}`);
  }
  finishLog(meta, 200, usageFromJson(openai), undefined);
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

function protocolFor(path: string): string {
  if (path.includes('/chat/completions')) return 'openai-chat';
  if (path.includes('/images/')) return 'openai-image';
  if (path.includes('/embeddings')) return 'openai-embeddings';
  if (path.includes('/completions')) return 'openai-complete';
  return 'openai';
}

/** Pass a delegated response back to the client while capturing usage + logging. */
async function instrumentResponse(
  upstream: Response,
  meta: LogMeta
): Promise<Response> {
  const ct = upstream.headers.get('content-type') ?? '';
  const isStream = ct.includes('text/event-stream');

  if (isStream && upstream.body) {
    const parser = new UsageParser();
    const decoder = new TextDecoder();
    const reader = upstream.body.getReader();
    let logged = false;
    const done = (error?: string) => {
      if (logged) return;
      logged = true;
      finishLog(meta, upstream.status, parser.tokens(), error);
    };
    const out = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done: rdone, value } = await reader.read();
          if (rdone) {
            done();
            controller.close();
            return;
          }
          parser.feed(decoder.decode(value, { stream: true }));
          controller.enqueue(value);
        } catch (e) {
          done((e as Error).message);
          controller.close();
        }
      },
      cancel(reason) {
        reader.cancel(reason).catch(() => {});
        done('client closed');
      },
    });
    const headers = new Headers(upstream.headers);
    return new Response(out, { status: upstream.status, headers });
  }

  // Non-streaming: read fully, capture usage, then forward verbatim.
  const buf = await upstream.arrayBuffer();
  let tokens;
  let error: string | undefined;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(buf));
    tokens = usageFromJson(parsed);
  } catch {
    tokens = undefined;
  }
  if (!upstream.ok) error = `HTTP ${upstream.status}`;
  finishLog(meta, upstream.status, tokens, error);
  const headers = new Headers(upstream.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(buf, { status: upstream.status, headers });
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
