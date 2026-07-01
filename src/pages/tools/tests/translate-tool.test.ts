import {
  buildTranslateMessages,
  TRANSLATE_LANGUAGES,
  TRANSLATE_STYLES,
} from "@/lib/translateTool";

export function runTranslateToolTests() {
  const messages = buildTranslateMessages({
    input: "Hello, world.",
    sourceLanguage: "auto",
    targetLanguage: "zh",
    style: "technical",
  });

  console.assert(messages.length === 2, "translation prompt should use two messages");
  console.assert(messages[0]?.role === "system", "first message should be system");
  console.assert(messages[1]?.role === "user", "second message should be user");
  console.assert(
    String(messages[1]?.content).includes("Hello, world."),
    "user message should contain the source text"
  );
  console.assert(
    String(messages[1]?.content).includes("技术文档"),
    "technical style should be represented in the prompt"
  );
  console.assert(
    TRANSLATE_LANGUAGES.some((l) => l.value === "es"),
    "Spanish should be a supported language"
  );
  console.assert(
    TRANSLATE_STYLES.some((s) => s.value === "natural"),
    "natural should be a supported style"
  );
}
