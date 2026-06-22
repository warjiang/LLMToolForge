/**
 * Pure helpers behind the developer utility tools.
 * Each returns a discriminated result so the UI can show errors inline.
 */

export type ToolResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

const ok = (value: string): ToolResult => ({ ok: true, value });
const err = (error: string): ToolResult => ({ ok: false, error });

/* ----------------------------- URL ----------------------------- */

export function urlEncode(input: string, full: boolean): ToolResult {
  try {
    return ok(full ? encodeURI(input) : encodeURIComponent(input));
  } catch (e) {
    return err(e instanceof Error ? e.message : "编码失败");
  }
}

export function urlDecode(input: string, full: boolean): ToolResult {
  try {
    return ok(full ? decodeURI(input) : decodeURIComponent(input));
  } catch (e) {
    return err(e instanceof Error ? e.message : "解码失败：包含无效的转义序列");
  }
}

/* --------------------------- Escape ---------------------------- */

/** Escape a raw string into a JSON-safe string literal body (no surrounding quotes). */
export function jsonEscape(input: string): ToolResult {
  try {
    const quoted = JSON.stringify(input);
    return ok(quoted.slice(1, -1));
  } catch (e) {
    return err(e instanceof Error ? e.message : "转义失败");
  }
}

/** Reverse of jsonEscape: turn escape sequences back into raw characters. */
export function jsonUnescape(input: string): ToolResult {
  try {
    // Wrap as a JSON string so the engine resolves \n \t \uXXXX \" etc.
    const wrapped = `"${input.replace(/\\?"/g, '\\"')}"`;
    return ok(JSON.parse(wrapped) as string);
  } catch (e) {
    return err(e instanceof Error ? e.message : "去转义失败：包含无效的转义序列");
  }
}

/* --------------------------- Unicode --------------------------- */

/** Convert each character to a \uXXXX escape (ascii option keeps printable ASCII). */
export function unicodeEncode(input: string, asciiOnly: boolean): ToolResult {
  try {
    let out = "";
    for (const ch of input) {
      const code = ch.codePointAt(0)!;
      if (asciiOnly && code >= 0x20 && code <= 0x7e) {
        out += ch;
        continue;
      }
      if (code > 0xffff) {
        // Emit surrogate pair
        const high = Math.floor((code - 0x10000) / 0x400) + 0xd800;
        const low = ((code - 0x10000) % 0x400) + 0xdc00;
        out +=
          "\\u" +
          high.toString(16).padStart(4, "0") +
          "\\u" +
          low.toString(16).padStart(4, "0");
      } else {
        out += "\\u" + code.toString(16).padStart(4, "0");
      }
    }
    return ok(out);
  } catch (e) {
    return err(e instanceof Error ? e.message : "编码失败");
  }
}

/** Decode \uXXXX (and \xXX / &#...; ) escapes back to characters. */
export function unicodeDecode(input: string): ToolResult {
  try {
    const out = input
      .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) =>
        String.fromCodePoint(parseInt(h, 16))
      )
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16))
      )
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16))
      )
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
        String.fromCodePoint(parseInt(h, 16))
      )
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
    return ok(out);
  } catch (e) {
    return err(e instanceof Error ? e.message : "解码失败");
  }
}

/* ---------------------- JSON deep preview ---------------------- */

const looksLikeJson = (s: string): boolean => {
  const t = s.trim();
  if (t.length < 2) return false;
  const a = t[0];
  const b = t[t.length - 1];
  return (
    (a === "{" && b === "}") ||
    (a === "[" && b === "]") ||
    (a === '"' && b === '"')
  );
};

/**
 * Recursively unwrap string values that are themselves JSON (possibly escaped
 * or double-encoded). Best-effort: anything that fails to parse is kept as-is.
 */
function deepUnwrap(value: unknown, depth = 0): unknown {
  if (depth > 64) return value;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (looksLikeJson(trimmed)) {
      try {
        const parsed = JSON.parse(trimmed);
        // Avoid infinitely re-wrapping a plain quoted scalar into itself
        if (typeof parsed === "string" && parsed === value) return value;
        return deepUnwrap(parsed, depth + 1);
      } catch {
        return value;
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepUnwrap(item, depth + 1));
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = deepUnwrap(v, depth + 1);
    }
    return out;
  }

  return value;
}

/**
 * Parse the input as JSON in a forgiving way and pretty-print it.
 * Falls back to unwrapping double-encoded / escaped payloads.
 */
export function jsonPreview(
  input: string,
  opts: { deep: boolean; indent: number } = { deep: true, indent: 2 }
): ToolResult {
  const raw = input.trim();
  if (!raw) return ok("");

  const tryParse = (s: string): unknown | undefined => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  let parsed = tryParse(raw);

  // If direct parse fails, the payload may be an escaped JSON string
  // (e.g. {\"a\":1}); wrap & parse once to strip the escaping.
  if (parsed === undefined) {
    const unescaped = tryParse(`"${raw.replace(/\\?"/g, '\\"')}"`);
    if (typeof unescaped === "string") {
      parsed = tryParse(unescaped.trim());
    }
  }

  if (parsed === undefined) {
    return err("无法解析为 JSON：请检查语法是否正确");
  }

  const result = opts.deep ? deepUnwrap(parsed) : parsed;

  try {
    return ok(JSON.stringify(result, null, opts.indent));
  } catch (e) {
    return err(e instanceof Error ? e.message : "序列化失败（可能存在循环引用）");
  }
}
