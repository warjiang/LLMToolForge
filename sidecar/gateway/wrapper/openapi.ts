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
        ResponsesRequest: {
          type: 'object',
          required: ['model', 'input'],
          description:
            'OpenAI Responses 请求。内置 agent 仅对 gpt-6-astra 且带函数工具时选用此协议；采用无状态 item 回放（store=false，不使用 previous_response_id）。',
          properties: {
            model: { $ref: '#/components/schemas/Model' },
            input: {
              type: 'array',
              description:
                '有序输入项：system/user 消息，以及回放的 function_call / function_call_output / reasoning item。',
              items: { type: 'object' },
            },
            stream: { type: 'boolean', default: true },
            store: {
              type: 'boolean',
              default: false,
              description: '固定为 false：网关不提供服务端会话存储。',
            },
            tools: {
              type: 'array',
              description: '函数工具定义（保留原始 description 与 JSON schema）。',
              items: { type: 'object' },
            },
            include: {
              type: 'array',
              description:
                '需要回放的推理状态，例如 reasoning.encrypted_content；不注入 reasoning.effort。',
              items: { type: 'string' },
            },
            max_output_tokens: { type: 'integer' },
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
      '/v1/responses': {
        post: {
          summary: 'OpenAI Responses 端点（内置 agent 对 gpt-6-astra 工具轮次选用）',
          description:
            '语义化 SSE 事件流（response.created / output_item / function_call_arguments / response.completed 等）。采用无状态 item 回放：请求携带回放的 function_call、function_call_output 与 reasoning item，store=false，不提供服务端会话或 response 检索 API。',
          operationId: 'responses',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ResponsesRequest' },
              },
            },
          },
          responses: {
            '200': {
              description:
                'Responses 结果；当 stream=true 时为 text/event-stream（语义事件，以 response.completed 收尾）。传输中断时网关发出 event: error 帧。',
              content: {
                'application/json': { schema: { type: 'object' } },
                'text/event-stream': { schema: { type: 'string' } },
              },
            },
            '401': errorResponse('未授权'),
            '404': errorResponse('模型未找到（非“端点不支持”）'),
            '502': errorResponse('上游错误 / 输出不完整 / 流被截断'),
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
