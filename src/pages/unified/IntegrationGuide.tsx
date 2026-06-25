import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function CodeBlock({ code }: { code: string }) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-md border border-border bg-secondary/40 p-3 text-copy-13 leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        onClick={copy}
        className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={t("copy")}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-heading-14">{title}</h4>
      {children}
    </div>
  );
}

export function IntegrationGuide({
  baseUrl,
  localKey,
  sampleModel,
}: {
  baseUrl: string;
  localKey: string;
  sampleModel: string;
}) {
  const { t } = useTranslation("pages");
  const key = localKey || "<optional: any value is fine when local key auth is disabled>";
  const openaiBase = `${baseUrl}/v1`;
  const model = sampleModel || "{connName}/{model}";

  const curlChat = `curl ${openaiBase}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${key}" \\
  -d '{
    "model": "${model}",
    "messages": [{ "role": "user", "content": "Hello" }],
    "stream": false
  }'`;

  const curlModels = `curl ${openaiBase}/models -H "Authorization: Bearer ${key}"`;

  const py = `from openai import OpenAI

client = OpenAI(
    base_url="${openaiBase}",
    api_key="${key}",
)

resp = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello"}],
)
print(resp.choices[0].message.content)`;

  const node = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${openaiBase}",
  apiKey: "${key}",
});

const resp = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(resp.choices[0].message.content);`;

  const codex = `# Environment variables
export OPENAI_BASE_URL="${openaiBase}"
export OPENAI_API_KEY="${key}"

codex --model "${model}"`;

  const claude = `# Claude Code via Anthropic-compatible endpoint (${baseUrl}/v1/messages)
export ANTHROPIC_BASE_URL="${baseUrl}"
export ANTHROPIC_API_KEY="${key}"
export ANTHROPIC_MODEL="${model}"

claude`;

  const pyImage = `from openai import OpenAI

client = OpenAI(
    base_url="${openaiBase}",
    api_key="${key}",
)

resp = client.images.generate(
    model="${model}",
    prompt="a red panda",
    n=1,
    size="1024x1024",
    response_format="url",
)
print(resp.data[0].url)`;

  const nodeImage = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${openaiBase}",
  apiKey: "${key}",
});

const resp = await client.images.generate({
  model: "${model}",
  prompt: "a red panda",
  n: 1,
  size: "1024x1024",
  response_format: "url",
});
console.log(resp.data[0].url);`;

  const curlImage = `curl ${openaiBase}/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${key}" \\
  -d '{
    "model": "${model}",
    "prompt": "a red panda",
    "n": 1,
    "size": "1024x1024",
    "response_format": "url"
  }'`;

  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-copy-13">
          <span className="text-muted-foreground">OpenAI Base URL</span>
          <code className="font-mono text-foreground">{openaiBase}</code>
          <span className="text-muted-foreground">Anthropic Base URL</span>
          <code className="font-mono text-foreground">{baseUrl}</code>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm">
            <a href={`${baseUrl}/docs`} target="_blank" rel="noreferrer">
              {t("ig_interactive_docs")}
            </a>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <a href={`${baseUrl}/openapi.json`} target="_blank" rel="noreferrer">
              {t("ig_openapi")}
            </a>
          </Button>
        </div>
      </Card>

      <Card className="grid gap-6 p-5 lg:grid-cols-2">
        <Section title="OpenAI Python SDK">
          <CodeBlock code={py} />
        </Section>
        <Section title="OpenAI Node SDK">
          <CodeBlock code={node} />
        </Section>
        <Section title={t("ig_curl_chat")}>
          <CodeBlock code={curlChat} />
        </Section>
        <Section title={t("ig_curl_models")}>
          <CodeBlock code={curlModels} />
        </Section>
        <Section title="Codex">
          <CodeBlock code={codex} />
        </Section>
        <Section title="Claude Code">
          <CodeBlock code={claude} />
        </Section>
        <Section title={t("ig_py_image")}>
          <CodeBlock code={pyImage} />
        </Section>
        <Section title={t("ig_node_image")}>
          <CodeBlock code={nodeImage} />
        </Section>
        <Section title={t("ig_curl_image")}>
          <CodeBlock code={curlImage} />
        </Section>
      </Card>
    </div>
  );
}
