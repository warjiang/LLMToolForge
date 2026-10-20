import { describe, expect, test } from "vitest";
import { AGENT_INTERNAL_TOOL_IDS } from "@/types";
import { DEFAULT_CHAT_SETTINGS, type ChatSessionSettings } from "@/types/chat";
import {
  buildAdHocAgentDef,
  resolveGeneralAgentProfile,
} from "../generalAgentProfile";
import { agentRuntimeSignature } from "../agentRuntimeSignature";

function settings(
  patch: Partial<ChatSessionSettings> = {}
): ChatSessionSettings {
  return {
    ...DEFAULT_CHAT_SETTINGS,
    sessionId: "session",
    updatedAt: "2026-10-20T00:00:00.000Z",
    ...patch,
  };
}

describe("resolveGeneralAgentProfile", () => {
  test("chat delivery excludes report artifact tools but keeps charts and file work", () => {
    const profile = resolveGeneralAgentProfile(settings());

    expect(profile.enabledInternalTools).not.toContain("data_report_html");
    expect(profile.enabledInternalTools).not.toContain("html_artifact_create");
    expect(profile.enabledInternalTools).not.toContain("html_artifact_block");
    expect(profile.enabledInternalTools).toContain("data_chart_html");
    expect(profile.enabledInternalTools).toContain("write");
    expect(profile.enabledInternalTools).toEqual(
      AGENT_INTERNAL_TOOL_IDS.filter(
        (tool) =>
          ![
            "data_report_html",
            "html_artifact_create",
            "html_artifact_block",
          ].includes(tool)
      )
    );
  });

  test("HTML delivery keeps every internal tool", () => {
    expect(
      resolveGeneralAgentProfile(settings({ reportDelivery: "html" }))
        .enabledInternalTools
    ).toEqual(AGENT_INTERNAL_TOOL_IDS);
  });

  test("appends delivery guidance after the user system prompt", () => {
    const profile = resolveGeneralAgentProfile(
      settings({ system: "User session guidance" })
    );

    expect(profile.systemPrompt).toMatch(
      /^User session guidance\n\nReport delivery: chat\./
    );
    expect(resolveGeneralAgentProfile(settings()).systemPrompt).toMatch(
      /^Report delivery: chat\./
    );
  });

  test("uses the chat output floor but preserves a larger user value", () => {
    expect(
      resolveGeneralAgentProfile(settings({ maxTokens: "1024" })).maxTokens
    ).toBe(8192);
    expect(
      resolveGeneralAgentProfile(settings({ maxTokens: "16000" })).maxTokens
    ).toBe(16000);
    expect(
      resolveGeneralAgentProfile(
        settings({ reportDelivery: "html", maxTokens: "1024" })
      ).maxTokens
    ).toBe(1024);
    expect(
      resolveGeneralAgentProfile(
        settings({ reportDelivery: "html", maxTokens: "" })
      ).maxTokens
    ).toBe(4096);
  });

  test("instructs chat delivery to redirect HTML requests without hand-writing reports", () => {
    const instruction = resolveGeneralAgentProfile(settings()).systemPrompt;

    expect(instruction).toContain(
      'switch "Report delivery" (报告交付方式) to "HTML report" (HTML 报告)'
    );
    expect(instruction).toContain(
      "Do not hand-write an HTML report with write or bash instead."
    );
  });

  test("changes the runtime signature when delivery changes", () => {
    const chat = buildAdHocAgentDef(settings(), "connection/model");
    const html = buildAdHocAgentDef(
      settings({ reportDelivery: "html" }),
      "connection/model"
    );

    expect(agentRuntimeSignature(chat, "/workspace")).not.toBe(
      agentRuntimeSignature(html, "/workspace")
    );
    expect(agentRuntimeSignature(chat, "/workspace")).toBe(
      agentRuntimeSignature(
        buildAdHocAgentDef(settings(), "connection/model"),
        "/workspace"
      )
    );
  });
});
