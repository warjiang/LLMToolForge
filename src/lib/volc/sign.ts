/**
 * Volcengine OpenAPI request signing.
 *
 * Implements the Volcengine "HMAC-SHA256" signature (a SigV4-style scheme) using
 * the WebCrypto `crypto.subtle` API so it runs in the WebView without extra deps.
 *
 * Verified against the official SDKs (volcengine/volc-sdk-golang,
 * volcengine/veadk-go). Note the algorithm string is literally `HMAC-SHA256`
 * (there is no `VOLC4-` prefix).
 */

const ALGORITHM = "HMAC-SHA256";
const EMPTY_BODY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface SignParams {
  method: string;
  host: string;
  /** Request path, e.g. "/". */
  path: string;
  /** Query parameters (e.g. Action, Version). */
  query: Record<string, string>;
  /** Raw request body string. */
  body: string;
  accessKey: string;
  secretKey: string;
  service: string;
  region: string;
  /** Optional STS session token. */
  sessionToken?: string;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  return toHex(await crypto.subtle.digest("SHA-256", data));
}

async function hmac(
  key: ArrayBuffer | Uint8Array,
  msg: string
): Promise<ArrayBuffer> {
  const keyData =
    key instanceof Uint8Array ? key : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(msg));
}

/** RFC3986-style encoding using the unreserved set a-z A-Z 0-9 - _ . ~ */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function buildCanonicalQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(query[k])}`)
    .join("&");
}

/** "20240115T100000Z" */
function formatXDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * Produce the signed URL + headers for a Volcengine OpenAPI request.
 */
export async function signVolcRequest(
  params: SignParams
): Promise<SignedRequest> {
  const now = new Date();
  const xDate = formatXDate(now);
  const dateStamp = xDate.slice(0, 8);

  const bodyHash = params.body
    ? await sha256Hex(params.body)
    : EMPTY_BODY_SHA256;

  const signedHeadersMap: Record<string, string> = {
    "content-type": "application/json",
    host: params.host,
    "x-content-sha256": bodyHash,
    "x-date": xDate,
  };
  if (params.sessionToken) {
    signedHeadersMap["x-security-token"] = params.sessionToken;
  }

  const sortedHeaderNames = Object.keys(signedHeadersMap).sort();
  const signedHeaders = sortedHeaderNames.join(";");
  const canonicalHeaders =
    sortedHeaderNames.map((n) => `${n}:${signedHeadersMap[n]}`).join("\n") +
    "\n";

  const canonicalQuery = buildCanonicalQuery(params.query);

  const canonicalRequest = [
    params.method.toUpperCase(),
    params.path || "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    bodyHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${params.region}/${params.service}/request`;
  const stringToSign = [
    ALGORITHM,
    xDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmac(new TextEncoder().encode(params.secretKey), dateStamp);
  const kRegion = await hmac(kDate, params.region);
  const kService = await hmac(kRegion, params.service);
  const kSigning = await hmac(kService, "request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  const authorization = `${ALGORITHM} Credential=${params.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    Authorization: authorization,
    "X-Date": xDate,
    "X-Content-Sha256": bodyHash,
    "Content-Type": "application/json",
  };
  if (params.sessionToken) {
    headers["X-Security-Token"] = params.sessionToken;
  }

  const url = `https://${params.host}${params.path || "/"}${
    canonicalQuery ? `?${canonicalQuery}` : ""
  }`;

  return { url, headers };
}
