import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/components/agent/BrowserPreview.test.tsx",
      "src/data/sync/tests/snapshot-delete.test.ts",
      "src/data/sync/tests/prompt-registration.test.ts",
      "src/data/sync/tests/prompt-sync.test.ts",
      "src/pages/agent/tests/attachment-input.test.ts",
      "src/pages/agent/tests/agent-error.test.ts",
      "src/pages/agent/tests/summary-report-artifacts.test.ts",
      "src/pages/agent/tests/summary-report-links.test.tsx",
      "src/pages/agent/composer/tests/use-composer-auto-resize.test.tsx",
      "src/pages/agent/prompts/tests/prompt-list.test.ts",
      "src/pages/agent/prompts/tests/prompt-components.test.tsx",
      "src/pages/agent/prompts/tests/prompt-composer-apply.test.tsx",
      "src/pages/api-keys/tests/api-key-dialog.test.tsx",
      "src/pages/providers/tests/provider-model-candidates.test.tsx",
      "src/pages/tools/tests/tools-page.test.ts",
      "src/pages/tools/tests/creativity-*.test.{ts,tsx}",
      "src/pages/tools/tests/shell-notebook-*.test.{ts,tsx}",
      "src/lib/tests/shell-notebook.test.ts",
      "src/lib/agent/tests/model-transport.test.ts",
      "src/lib/agent/tests/responses-provider.test.ts",
      "src/lib/agent/tests/responses-runtime.test.ts",
      "src/lib/prompt/tests/prompt-domain.test.ts",
      "src/store/tests/chat-title-hint.test.ts",
      "src/store/tests/prompt-recent.test.ts",
    ],
    clearMocks: true,
  },
});
