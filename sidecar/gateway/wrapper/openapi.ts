/**
 * OpenAPI 3.1 document and an embedded Redoc documentation page for the unified
 * gateway. Served unauthenticated at `GET /openapi.json` and `GET /docs` so the
 * app's integration guide can link to interactive docs.
 *
 * The `model` field enum is filled from the currently-exposed routes so
 * generated clients see the real model options.
 */

/** Build the OpenAPI document, listing the given exposed model ids as the enum. */
export function buildSpec(models: string[]): unknown {
  const modelSchema =
    models.length === 0
      ? { type: 'string', description: '暴露的模型 id，形如 {连接名}/{model}' }
      : {
          type: 'string',
          description: '暴露的模型 id，形如 {连接名}/{model}',
          enum: models,
        };

  const errorRef = { $ref: '#/components/schemas/Error' };
  const errorResponse = (description: string) => ({
    description,
    content: { 'application/json': { schema: errorRef } },
  });

  return {
    openapi: '3.1.0',
    info: {
      title: 'LLMToolForge Unified API',
      version: '1.0.0',
      description:
        '本地统一模型网关（基于 Portkey）。OpenAI 兼容端点（/v1/models、/v1/chat/completions）供 Codex 与通用 agent 使用；Anthropic 兼容端点（/v1/messages）供 Claude Code 使用。所有请求按 model 路由到已接入的上游 provider。',
    },
    servers: [{ url: '/', description: '本地服务' }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            '可选。若在应用内设置了本地 API Key，则需在 Authorization 头携带 Bearer <key>（Anthropic 客户端也可用 x-api-key）。',
        },
      },
      schemas: {
        Model: modelSchema,
        ChatMessage: {
          type: 'object',
          required: ['role', 'content'],
          properties: {
            role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
            content: {},
          },
        },
        ChatCompletionRequest: {
          type: 'object',
          required: ['model', 'messages'],
          properties: {
            model: { $ref: '#/components/schemas/Model' },
            messages: { type: 'array', items: { $ref: '#/components/schemas/ChatMessage' } },
            temperature: { type: 'number' },
            top_p: { type: 'number' },
            max_tokens: { type: 'integer' },
            stream: { type: 'boolean', default: false },
            tools: { type: 'array', items: { type: 'object' } },
            tool_choice: {},
          },
        },
        AnthropicMessageRequest: {
          type: 'object',
          required: ['model', 'messages', 'max_tokens'],
          properties: {
            model: { $ref: '#/components/schemas/Model' },
            system: {},
            messages: { type: 'array', items: { type: 'object' } },
            max_tokens: { type: 'integer' },
            temperature: { type: 'number' },
            top_p: { type: 'number' },
            stop_sequences: { type: 'array', items: { type: 'string' } },
            stream: { type: 'boolean', default: false },
            tools: { type: 'array', items: { type: 'object' } },
            tool_choice: {},
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                message: { type: 'string' },
                type: { type: 'string' },
                code: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    paths: {
      '/v1/models': {
        get: {
          summary: '列出已暴露的模型',
          operationId: 'listModels',
          responses: {
            '200': {
              description: 'OpenAI 兼容的模型列表',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      object: { type: 'string' },
                      data: { type: 'array', items: { type: 'object' } },
                    },
                  },
                },
              },
            },
            '401': errorResponse('本地 API Key 校验失败'),
          },
        },
      },
      '/v1/chat/completions': {
        post: {
          summary: 'OpenAI 兼容对话补全（支持 SSE 流式）',
          operationId: 'chatCompletions',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ChatCompletionRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: '对话补全结果；当 stream=true 时为 text/event-stream',
              content: {
                'application/json': { schema: { type: 'object' } },
                'text/event-stream': { schema: { type: 'string' } },
              },
            },
            '401': errorResponse('未授权'),
            '404': errorResponse('模型未找到'),
            '502': errorResponse('上游错误'),
          },
        },
      },
      '/v1/images/generations': {
        post: {
          summary: 'OpenAI 兼容图像生成',
          operationId: 'imageGenerations',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['model', 'prompt'],
                  properties: {
                    model: { $ref: '#/components/schemas/Model' },
                    prompt: { type: 'string' },
                    n: { type: 'integer', default: 1 },
                    size: { type: 'string' },
                    response_format: {
                      type: 'string',
                      enum: ['url', 'b64_json'],
                      default: 'url',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: '图像生成结果', content: { 'application/json': { schema: { type: 'object' } } } },
            '401': errorResponse('未授权'),
            '404': errorResponse('模型未找到'),
            '502': errorResponse('上游错误'),
          },
        },
      },
      '/v1/messages': {
        post: {
          summary: 'Anthropic 兼容消息（供 Claude Code，支持 SSE 流式与工具调用）',
          operationId: 'anthropicMessages',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AnthropicMessageRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Anthropic message 结果；当 stream=true 时为 text/event-stream',
              content: {
                'application/json': { schema: { type: 'object' } },
                'text/event-stream': { schema: { type: 'string' } },
              },
            },
            '401': errorResponse('未授权'),
            '404': errorResponse('模型未找到'),
            '502': errorResponse('上游错误'),
          },
        },
      },
    },
  };
}

export const REDOC_HTML = `<!DOCTYPE html>
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
</html>`;
