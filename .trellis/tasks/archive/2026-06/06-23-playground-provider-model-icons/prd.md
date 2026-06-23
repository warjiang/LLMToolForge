# Add provider and model icons

## Goal

Show provider and model icons in Playground and provider/model surfaces, using LobeHub icon references and generated LiteLLM/DMX assets.

## Requirements

- Add a reusable frontend icon layer for model providers and model families.
- Use LobeHub Icons as the visual reference for well-known LLM providers/models where practical, without adding a new package dependency.
- Add provider icons for existing configured providers: Volcengine, New API, LiteLLM, DMXAPI, and manual OpenAI-compatible keys.
- Add model-family icons for common model ids/names surfaced by `/v1/models`, including OpenAI, Claude/Anthropic, Gemini/Google, DeepSeek, Qwen, Doubao/Volcengine, Moonshot/Kimi, Mistral, Llama/Meta, Grok/xAI, Groq, Ollama, and fallback generic models.
- Extract or generate usable local SVG assets for LiteLLM and DMXAPI when no existing in-repo icon is available.
- Show icons in Playground connection and model selectors, selected model summary, and provider model lists.
- Keep the implementation local and dependency-free; no runtime network icon loading.
- Preserve existing provider/model selection behavior and build output.

## Acceptance Criteria

- [ ] Provider selector options show provider icons next to connection names.
- [ ] Model selector options show model-family icons next to model names.
- [ ] Selected provider/model values remain readable in the compact composer.
- [ ] Provider management pages show provider/model icons in gateway and Volcengine model lists.
- [ ] LiteLLM and DMXAPI have local generated/extracted icons that render in light and dark themes.
- [ ] Unknown providers/models fall back to a stable generic icon.
- [ ] `pnpm build` succeeds.

## Notes

- Lightweight task; PRD-only is sufficient.
- User references:
  - LobeHub Icons: https://lobehub.com/icons
  - LiteLLM: https://www.litellm.ai/
  - DMXAPI: https://www.dmxapi.cn/
