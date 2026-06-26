/**
 * Pi-style skill support.
 *
 * Enabled skills are advertised in the system prompt as an
 * `<available_skills>` block, and a single `load_skill` tool returns a skill's
 * full markdown content on demand. This mirrors how Pi/Claude skills work:
 * the model first sees names + descriptions, then loads a skill when relevant.
 */

import { Type } from "@earendil-works/pi-ai";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Skill } from "@/types";
import { text } from "./shared";

/** Identity helper that preserves TypeBox param inference for `execute`. */
function defineTool<P extends TSchema>(def: {
  name: string;
  label: string;
  description: string;
  parameters: P;
  execute: (
    id: string,
    params: Static<P>,
    signal?: AbortSignal
  ) => Promise<AgentToolResult<unknown>>;
}): AgentTool {
  return def as unknown as AgentTool;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Format enabled skills as an `<available_skills>` XML block. */
export function formatSkillsPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";
  const items = skills
    .map((s) => {
      const name = escapeXml(s.name || s.id);
      const desc = escapeXml(s.description || "");
      return `  <skill>\n    <name>${name}</name>\n    <description>${desc}</description>\n  </skill>`;
    })
    .join("\n");
  return [
    "<available_skills>",
    "The following skills are available. When a skill is relevant, call the",
    "`load_skill` tool with its exact name to load detailed instructions before",
    "acting. Only load a skill when it matches the task.",
    items,
    "</available_skills>",
  ].join("\n");
}

/** Build the `load_skill` tool over the enabled skills. */
export function buildLoadSkillTool(skills: Skill[]): AgentTool {
  const byName = new Map<string, Skill>();
  for (const s of skills) {
    byName.set(s.name || s.id, s);
  }
  return defineTool({
    name: "load_skill",
    label: "Load skill",
    description:
      "Load the full instructions for an available skill by its exact name. " +
      "Returns the skill's markdown content.",
    parameters: Type.Object({
      name: Type.String({ description: "Exact skill name to load." }),
    }),
    execute: async (_id, params) => {
      const skill = byName.get(params.name);
      if (!skill) {
        const available = [...byName.keys()].join(", ") || "(none)";
        throw new Error(
          `未找到 skill "${params.name}"。可用 skills: ${available}`
        );
      }
      const content = skill.content?.trim();
      if (!content) {
        throw new Error(`Skill "${skill.name}" 没有内容`);
      }
      return {
        content: [text(content)],
        details: { skill: skill.name },
      };
    },
  });
}
