/**
 * Parse a SKILL.md document into its frontmatter fields and body.
 *
 * Skills follow the convention of a YAML frontmatter block delimited by `---`
 * lines, carrying at least `name` and `description`, followed by the markdown
 * body. We intentionally implement a tiny, dependency-free parser that only
 * understands the small subset of YAML these files use (flat `key: value`
 * pairs, optional quotes, optional block scalars) so we don't pull in a YAML
 * runtime just for this.
 */

export interface ParsedSkill {
  name?: string;
  description?: string;
  /** The markdown body with the frontmatter stripped. */
  body: string;
  /** All recognised frontmatter scalar fields. */
  frontmatter: Record<string, string>;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = block.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i += 1;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    // Block scalar (`key: |` or `key: >`): gather following indented lines.
    if (value === "|" || value === ">" || value === "|-" || value === ">-") {
      const folded = value.startsWith(">");
      const collected: string[] = [];
      while (
        i < lines.length &&
        (lines[i].startsWith("  ") || lines[i].trim() === "")
      ) {
        collected.push(lines[i].replace(/^ {1,2}/, ""));
        i += 1;
      }
      out[key] = collected.join(folded ? " " : "\n").trim();
      continue;
    }
    out[key] = stripQuotes(value);
  }
  return out;
}

export function parseSkillMarkdown(raw: string): ParsedSkill {
  const normalized = raw.replace(/^\uFEFF/, "");
  const fmMatch = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(normalized);
  if (!fmMatch) {
    return { body: normalized.trim(), frontmatter: {} };
  }
  const frontmatter = parseFrontmatter(fmMatch[1]);
  const body = normalized.slice(fmMatch[0].length).trim();
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    body,
    frontmatter,
  };
}

/** Parse one YAML scalar / flow-sequence value into a string list. */
function parseStringList(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => stripQuotes(item))
      .filter(Boolean);
  }
  if (!trimmed) return [];
  return [stripQuotes(trimmed)];
}

/**
 * Extract a skill's declared external requirements from its `metadata.requires`
 * frontmatter block. Supports both inline (`bins: ["a", "b"]`) and block-list
 * (`bins:` followed by `- a`) forms. Returns the deduplicated bin list.
 */
export function parseSkillRequirements(raw: string): { bins?: string[] } {
  const normalized = raw.replace(/^\uFEFF/, "");
  const fmMatch = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(normalized);
  if (!fmMatch) return {};

  const lines = fmMatch[1].split(/\r?\n/);
  const reqIdx = lines.findIndex((l) => /^\s*requires:\s*(\{.*\})?\s*$/.test(l));
  if (reqIdx === -1) return {};

  const baseIndent = lines[reqIdx].search(/\S/);
  const bins: string[] = [];

  for (let i = reqIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.search(/\S/) <= baseIndent) break; // left the `requires:` block

    const binMatch = /^\s*bins:\s*(.*)$/.exec(line);
    if (!binMatch) continue;

    if (binMatch[1].trim()) {
      bins.push(...parseStringList(binMatch[1]));
    } else {
      // Block list: gather following `- item` lines.
      for (let j = i + 1; j < lines.length; j += 1) {
        const itemMatch = /^\s*-\s*(.*)$/.exec(lines[j]);
        if (!itemMatch) {
          if (lines[j].trim()) break;
          continue;
        }
        bins.push(stripQuotes(itemMatch[1]));
      }
    }
  }

  const unique = [...new Set(bins.filter(Boolean))];
  return unique.length ? { bins: unique } : {};
}
