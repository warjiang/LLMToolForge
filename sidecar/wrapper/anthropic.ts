/**
 * Anthropic Messages <-> OpenAI Chat Completions translation.
 *
 * Portkey's `/v1/messages` only supports providers that natively implement the
 * Anthropic Messages API; it cannot translate Anthropic requests to an
 * OpenAI-compatible upstream. This module fills that gap so Claude Code can talk
 * to any connected OpenAI-compatible model. Ported from the previous Rust
 * implementation (`src-tauri/src/unified/anthropic.rs`).
 */

type Json = any;

// ---------------------------------------------------------------------------
// Request translation: Anthropic Messages -> OpenAI Chat Completions
// ---------------------------------------------------------------------------

export function anthropicToOpenAI(
  req: Json,
  realModel: string,
  stream: boolean
): Json {
  const messages: Json[] = [];

  if (req?.system !== undefined) {
    const text = systemText(req.system);
    if (text) messages.push({ role: 'system', content: text });
  }

  if (Array.isArray(req?.messages)) {
    for (const m of req.messages) convertMessage(m, messages);
  }

  const body: Json = { model: realModel, messages, stream };

  if (typeof req?.max_tokens === 'number') body.max_tokens = req.max_tokens;
  if (typeof req?.temperature === 'number') body.temperature = req.temperature;
  if (typeof req?.top_p === 'number') body.top_p = req.top_p;
  if (req?.stop_sequences !== undefined) body.stop = req.stop_sequences;
  if (stream) body.stream_options = { include_usage: true };

  if (Array.isArray(req?.tools)) {
    const converted: Json[] = [];
    for (const t of req.tools) {
      const name = t?.name;
      if (typeof name !== 'string') continue;
      converted.push({
        type: 'function',
        function: {
          name,
          description: typeof t.description === 'string' ? t.description : '',
          parameters: t.input_schema ?? { type: 'object' },
        },
      });
    }
    if (converted.length) body.tools = converted;
  }

  if (req?.tool_choice !== undefined) {
    const mapped = mapToolChoice(req.tool_choice);
    if (mapped !== undefined) body.tool_choice = mapped;
  }

  return body;
}

function systemText(system: Json): string {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .map((b) => (typeof b?.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function convertMessage(m: Json, out: Json[]): void {
  const role = typeof m?.role === 'string' ? m.role : 'user';
  const content = m?.content;

  if (typeof content === 'string') {
    out.push({ role, content });
    return;
  }

  if (!Array.isArray(content)) {
    out.push({ role, content: '' });
    return;
  }

  const parts: Json[] = [];
  const toolCalls: Json[] = [];
  const toolResults: Json[] = [];

  for (const block of content) {
    switch (block?.type) {
      case 'text':
        if (typeof block.text === 'string')
          parts.push({ type: 'text', text: block.text });
        break;
      case 'image': {
        const url = imageUrl(block);
        if (url) parts.push({ type: 'image_url', image_url: { url } });
        break;
      }
      case 'tool_use': {
        const id = typeof block.id === 'string' ? block.id : '';
        const name = typeof block.name === 'string' ? block.name : '';
        const input = block.input ?? {};
        toolCalls.push({
          id,
          type: 'function',
          function: { name, arguments: JSON.stringify(input) },
        });
        break;
      }
      case 'tool_result': {
        const id =
          typeof block.tool_use_id === 'string' ? block.tool_use_id : '';
        const text = toolResultText(block.content);
        toolResults.push({ role: 'tool', tool_call_id: id, content: text });
        break;
      }
      default:
        break;
    }
  }

  for (const tr of toolResults) out.push(tr);

  if (role === 'assistant') {
    const msg: Json = { role: 'assistant' };
    if (parts.length === 1 && parts[0].type === 'text') {
      msg.content = parts[0].text;
    } else if (parts.length) {
      msg.content = parts;
    } else {
      msg.content = null;
    }
    if (toolCalls.length) msg.tool_calls = toolCalls;
    if (msg.content !== null || msg.tool_calls !== undefined) out.push(msg);
  } else if (parts.length) {
    const c =
      parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;
    out.push({ role: 'user', content: c });
  }
}

function imageUrl(block: Json): string | undefined {
  const source = block?.source;
  if (!source) return undefined;
  if (source.type === 'base64') {
    const media = source.media_type;
    const data = source.data;
    if (typeof media === 'string' && typeof data === 'string')
      return `data:${media};base64,${data}`;
    return undefined;
  }
  if (source.type === 'url' && typeof source.url === 'string') return source.url;
  return undefined;
}

function toolResultText(content: Json): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b?.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (content === undefined || content === null) return '';
  return JSON.stringify(content);
}

function mapToolChoice(tc: Json): Json | undefined {
  switch (tc?.type) {
    case 'auto':
      return 'auto';
    case 'any':
      return 'required';
    case 'tool':
      if (typeof tc.name === 'string')
        return { type: 'function', function: { name: tc.name } };
      return undefined;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Response translation: OpenAI -> Anthropic (non-streaming)
// ---------------------------------------------------------------------------

export function openAIToAnthropicMessage(openai: Json, model: string): Json {
  const choice = openai?.choices?.[0];
  const message = choice?.message;
  const finish = typeof choice?.finish_reason === 'string'
    ? choice.finish_reason
    : undefined;

  const content: Json[] = [];
  if (typeof message?.content === 'string' && message.content.length) {
    content.push({ type: 'text', text: message.content });
  }
  if (Array.isArray(message?.tool_calls)) {
    for (const call of message.tool_calls) {
      const id = typeof call?.id === 'string' ? call.id : '';
      const name =
        typeof call?.function?.name === 'string' ? call.function.name : '';
      const args =
        typeof call?.function?.arguments === 'string'
          ? call.function.arguments
          : '{}';
      let input: Json;
      try {
        input = JSON.parse(args);
      } catch {
        input = {};
      }
      content.push({ type: 'tool_use', id, name, input });
    }
  }

  const usage = openai?.usage;
  const inputTokens =
    typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
  const outputTokens =
    typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0;

  return {
    id: typeof openai?.id === 'string' ? openai.id : '',
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: mapStopReason(finish),
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

export function mapStopReason(finish: string | undefined): Json {
  switch (finish) {
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    case 'stop':
      return 'end_turn';
    case undefined:
      return null;
    default:
      return 'end_turn';
  }
}

// ---------------------------------------------------------------------------
// Response translation: OpenAI SSE -> Anthropic SSE (streaming)
// ---------------------------------------------------------------------------

const TEXT_KEY = 'text';

type OpenBlock =
  | { kind: 'none' }
  | { kind: 'text' }
  | { kind: 'tool'; oai: number };

function pushEvent(out: string[], event: string, data: Json): void {
  out.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Stateful translator from an OpenAI chat-completions SSE stream into Anthropic
 * Messages SSE events. Drive it with {@link feed} for each decoded text chunk
 * and {@link finish} when the upstream stream ends; both return ready-to-write
 * Anthropic SSE frames.
 */
export class AnthropicStreamTranslator {
  private model: string;
  private started = false;
  private nextIndex = 0;
  private open: OpenBlock = { kind: 'none' };
  /** openai tool index -> anthropic block index. */
  private toolIndex = new Map<number, number>();
  /** anthropic block index for the active text block. */
  private textBlockIndex = 0;
  private stopReason: Json = null;
  private finished = false;
  private lineBuf = '';

  inputTokens = 0;
  outputTokens = 0;

  constructor(model: string) {
    this.model = model;
  }

  feed(chunk: string): string[] {
    const out: string[] = [];
    this.lineBuf += chunk;
    let idx: number;
    while ((idx = this.lineBuf.indexOf('\n')) !== -1) {
      const line = this.lineBuf.slice(0, idx).trim();
      this.lineBuf = this.lineBuf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      if (data === '[DONE]') {
        this.doFinish(out);
        continue;
      }
      try {
        this.handleChunk(JSON.parse(data), out);
      } catch {
        // ignore non-JSON frames
      }
    }
    return out;
  }

  finish(): string[] {
    const out: string[] = [];
    this.doFinish(out);
    return out;
  }

  /** True once the closing Anthropic frames have been emitted (via `[DONE]` or finish). */
  isFinished(): boolean {
    return this.finished;
  }

  tokens(): { prompt?: number; completion?: number; total?: number } | undefined {
    if (this.inputTokens === 0 && this.outputTokens === 0) return undefined;
    return {
      prompt: this.inputTokens,
      completion: this.outputTokens,
      total: this.inputTokens + this.outputTokens,
    };
  }

  private ensureStarted(chunk: Json, out: string[]): void {
    if (this.started) return;
    this.started = true;
    if (typeof chunk?.usage?.prompt_tokens === 'number') {
      this.inputTokens = chunk.usage.prompt_tokens;
    }
    const id = typeof chunk?.id === 'string' ? chunk.id : 'msg';
    pushEvent(out, 'message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: this.inputTokens, output_tokens: 0 },
      },
    });
  }

  private closeOpen(out: string[]): void {
    let index: number;
    if (this.open.kind === 'none') return;
    if (this.open.kind === 'text') index = this.textBlockIndex;
    else index = this.toolIndex.get(this.open.oai) ?? 0;
    pushEvent(out, 'content_block_stop', {
      type: 'content_block_stop',
      index,
    });
    this.open = { kind: 'none' };
  }

  private handleChunk(chunk: Json, out: string[]): void {
    this.ensureStarted(chunk, out);

    const u = chunk?.usage;
    if (u && u !== null) {
      if (typeof u.completion_tokens === 'number')
        this.outputTokens = u.completion_tokens;
      if (typeof u.prompt_tokens === 'number') this.inputTokens = u.prompt_tokens;
    }

    const choice = chunk?.choices?.[0];
    if (!choice) return;

    const delta = choice.delta;
    if (delta) {
      if (typeof delta.content === 'string' && delta.content.length) {
        this.emitText(delta.content, out);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const call of delta.tool_calls) this.emitTool(call, out);
      }
    }

    if (typeof choice.finish_reason === 'string') {
      this.stopReason = mapStopReason(choice.finish_reason);
    }
  }

  private emitText(text: string, out: string[]): void {
    if (this.open.kind !== 'text') {
      this.closeOpen(out);
      const index = this.nextIndex++;
      this.textBlockIndex = index;
      this.open = { kind: 'text' };
      pushEvent(out, 'content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'text', text: '' },
      });
    }
    pushEvent(out, 'content_block_delta', {
      type: 'content_block_delta',
      index: this.textBlockIndex,
      delta: { type: 'text_delta', text },
    });
  }

  private emitTool(call: Json, out: string[]): void {
    const oaiIdx = typeof call?.index === 'number' ? call.index : 0;
    const isNew = !this.toolIndex.has(oaiIdx);
    if (isNew || !(this.open.kind === 'tool' && this.open.oai === oaiIdx)) {
      this.closeOpen(out);
    }
    if (isNew) {
      const index = this.nextIndex++;
      this.toolIndex.set(oaiIdx, index);
      const id = typeof call?.id === 'string' ? call.id : '';
      const name =
        typeof call?.function?.name === 'string' ? call.function.name : '';
      pushEvent(out, 'content_block_start', {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id, name, input: {} },
      });
    }
    this.open = { kind: 'tool', oai: oaiIdx };
    const args = call?.function?.arguments;
    if (typeof args === 'string' && args.length) {
      const index = this.toolIndex.get(oaiIdx) ?? 0;
      pushEvent(out, 'content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: args },
      });
    }
  }

  private doFinish(out: string[]): void {
    if (this.finished) return;
    this.finished = true;
    if (!this.started) this.ensureStarted({}, out);
    this.closeOpen(out);
    const stop = this.stopReason === null ? 'end_turn' : this.stopReason;
    pushEvent(out, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stop, stop_sequence: null },
      usage: { output_tokens: this.outputTokens },
    });
    pushEvent(out, 'message_stop', { type: 'message_stop' });
  }
}

// Avoid unused warning for the documented sentinel.
void TEXT_KEY;
