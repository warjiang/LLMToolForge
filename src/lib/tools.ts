/**
 * Pure helpers behind the developer utility tools.
 * Each returns a discriminated result so the UI can show errors inline.
 */
import i18n from "@/i18n/config";

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
    return err(e instanceof Error ? e.message : i18n.t("tool_encode_failed", { ns: "common" }));
  }
}

export function urlDecode(input: string, full: boolean): ToolResult {
  try {
    return ok(full ? decodeURI(input) : decodeURIComponent(input));
  } catch (e) {
    return err(
      e instanceof Error ? e.message : i18n.t("tool_decode_invalid_escape", { ns: "common" })
    );
  }
}

/* --------------------------- Escape ---------------------------- */

/** Escape a raw string into a JSON-safe string literal body (no surrounding quotes). */
export function jsonEscape(input: string): ToolResult {
  try {
    const quoted = JSON.stringify(input);
    return ok(quoted.slice(1, -1));
  } catch (e) {
    return err(e instanceof Error ? e.message : i18n.t("tool_escape_failed", { ns: "common" }));
  }
}

/** Reverse of jsonEscape: turn escape sequences back into raw characters. */
export function jsonUnescape(input: string): ToolResult {
  try {
    // Wrap as a JSON string so the engine resolves \n \t \uXXXX \" etc.
    const wrapped = `"${input.replace(/\\?"/g, '\\"')}"`;
    return ok(JSON.parse(wrapped) as string);
  } catch (e) {
    return err(
      e instanceof Error ? e.message : i18n.t("tool_unescape_invalid_escape", { ns: "common" })
    );
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
    return err(e instanceof Error ? e.message : i18n.t("tool_encode_failed", { ns: "common" }));
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
    return err(e instanceof Error ? e.message : i18n.t("tool_decode_failed", { ns: "common" }));
  }
}

/* ---------------------------- Base64 --------------------------- */

/** Unicode-safe Base64 encode (UTF-8 bytes → base64). */
export function base64Encode(input: string): ToolResult {
  try {
    const bytes = new TextEncoder().encode(input);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return ok(btoa(binary));
  } catch (e) {
    return err(e instanceof Error ? e.message : i18n.t("tool_encode_failed", { ns: "common" }));
  }
}

/** Unicode-safe Base64 decode (base64 → UTF-8 string). */
export function base64Decode(input: string): ToolResult {
  try {
    const cleaned = input.trim().replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
      return err(i18n.t("tool_base64_decode_invalid", { ns: "common" }));
    }
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return ok(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
  } catch {
    return err(i18n.t("tool_base64_decode_invalid", { ns: "common" }));
  }
}

/* ----------------------------- Hash ---------------------------- */

export type HashAlgo = "md5" | "sha-1" | "sha-256" | "sha-512";

function toHex(buffer: ArrayBuffer | Uint8Array): string {
  const view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Compute a hash digest as a lowercase hex string.
 * MD5 is implemented in pure JS (Web Crypto has no MD5); SHA-* use SubtleCrypto.
 */
export async function hashHex(input: string, algo: HashAlgo): Promise<ToolResult> {
  try {
    const bytes = new TextEncoder().encode(input);
    if (algo === "md5") {
      return ok(md5Hex(bytes));
    }
    const subtleAlgo = algo.toUpperCase(); // SHA-1 / SHA-256 / SHA-512
    const digest = await crypto.subtle.digest(subtleAlgo, bytes);
    return ok(toHex(digest));
  } catch (e) {
    return err(e instanceof Error ? e.message : i18n.t("tool_hash_failed", { ns: "common" }));
  }
}

/* ------------------------- MD5 (pure JS) ----------------------- */

/** Pure-JS MD5 over raw bytes, returning a 32-char lowercase hex string. */
function md5Hex(input: Uint8Array): string {
  const rotl = (x: number, c: number) => (x << c) | (x >>> (32 - c));
  const add = (a: number, b: number) => (a + b) | 0;

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
    9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
    16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10,
    15, 21,
  ];
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;
  }

  const originalLenBits = input.length * 8;
  // Padding: append 0x80, then zeros, then 64-bit little-endian length.
  const paddedLen = (((input.length + 8) >> 6) + 1) << 6;
  const bytes = new Uint8Array(paddedLen);
  bytes.set(input);
  bytes[input.length] = 0x80;
  // 64-bit length (we only fill the low 32 bits, sufficient for browser inputs).
  for (let i = 0; i < 4; i++) {
    bytes[paddedLen - 8 + i] = (originalLenBits >>> (8 * i)) & 0xff;
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const M = new Int32Array(16);
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      M[i] =
        bytes[j] |
        (bytes[j + 1] << 8) |
        (bytes[j + 2] << 16) |
        (bytes[j + 3] << 24);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = add(add(add(f, a), K[i]), M[g]);
      a = d;
      d = c;
      c = b;
      b = add(b, rotl(f, S[i]));
    }

    a0 = add(a0, a);
    b0 = add(b0, b);
    c0 = add(c0, c);
    d0 = add(d0, d);
  }

  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((word, w) => {
    for (let i = 0; i < 4; i++) {
      out[w * 4 + i] = (word >>> (8 * i)) & 0xff;
    }
  });
  return toHex(out);
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
    return err(i18n.t("tool_json_parse_failed", { ns: "common" }));
  }

  const result = opts.deep ? deepUnwrap(parsed) : parsed;

  try {
    return ok(JSON.stringify(result, null, opts.indent));
  } catch (e) {
    return err(
      e instanceof Error ? e.message : i18n.t("tool_json_serialize_failed", { ns: "common" })
    );
  }
}

export type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/**
 * Forgiving JSON parse used by the JSON editor / tree view.
 * When `preserveEscape` is false, nested escaped / double-encoded JSON strings
 * are recursively unwrapped; when true, the value is kept exactly as parsed.
 */
export function parseJson(
  input: string,
  opts: { preserveEscape: boolean } = { preserveEscape: false }
): JsonParseResult {
  const raw = input.trim();
  if (!raw) return { ok: true, value: undefined };

  const tryParse = (s: string): unknown | undefined => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  let parsed = tryParse(raw);
  if (parsed === undefined) {
    const unescaped = tryParse(`"${raw.replace(/\\?"/g, '\\"')}"`);
    if (typeof unescaped === "string") {
      parsed = tryParse(unescaped.trim());
    }
  }

  if (parsed === undefined) {
    return { ok: false, error: i18n.t("tool_json_parse_failed", { ns: "common" }) };
  }

  return { ok: true, value: opts.preserveEscape ? parsed : deepUnwrap(parsed) };
}

/** Pretty-print JSON with the given indent. */
export function jsonFormat(
  input: string,
  opts: { indent: number; preserveEscape: boolean } = {
    indent: 2,
    preserveEscape: false,
  }
): ToolResult {
  if (!input.trim()) return ok("");
  const parsed = parseJson(input, { preserveEscape: opts.preserveEscape });
  if (!parsed.ok) return err(parsed.error);
  try {
    return ok(JSON.stringify(parsed.value, null, opts.indent));
  } catch (e) {
    return err(
      e instanceof Error ? e.message : i18n.t("tool_json_serialize_failed", { ns: "common" })
    );
  }
}

/** Minify JSON to a single line. */
export function jsonMinify(
  input: string,
  opts: { preserveEscape: boolean } = { preserveEscape: false }
): ToolResult {
  if (!input.trim()) return ok("");
  const parsed = parseJson(input, { preserveEscape: opts.preserveEscape });
  if (!parsed.ok) return err(parsed.error);
  try {
    return ok(JSON.stringify(parsed.value));
  } catch (e) {
    return err(
      e instanceof Error ? e.message : i18n.t("tool_json_serialize_failed", { ns: "common" })
    );
  }
}
