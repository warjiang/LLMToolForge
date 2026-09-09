/**
 * Shared test harness for the Responses provider/runtime suites.
 *
 * These tests drive the REAL installed Pi SDK (`createUnifiedRuntime` +
 * `Agent`) against a mocked `globalThis.fetch` that serves queued SSE bodies
 * and records the outgoing request payloads. This exercises actual SDK
 * serialization and stream parsing rather than a hand-written fake.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures", "responses");

export function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockFetchResult {
  requests: CapturedRequest[];
  restore: () => void;
}

interface QueuedResponse {
  /** SSE body text, or a JSON object for non-streaming. */
  body: string;
  status?: number;
  contentType?: string;
}

/**
 * Install a `globalThis.fetch` mock that serves `queue` responses in order and
 * records each request. Any request past the queue length throws.
 */
export function installMockFetch(queue: QueuedResponse[]): MockFetchResult {
  const requests: CapturedRequest[] = [];
  const original = globalThis.fetch;
  let index = 0;

  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method =
      init?.method ??
      (typeof input === "object" && "method" in input
        ? (input as Request).method
        : "GET");
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders) {
      new Headers(rawHeaders as HeadersInit).forEach((v, k) => {
        headers[k] = v;
      });
    }
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    requests.push({ url, method, headers, body });

    const queued = queue[index++];
    if (!queued) {
      throw new Error(`mock fetch: no queued response for request #${index}`);
    }
    const status = queued.status ?? 200;
    const contentType =
      queued.contentType ??
      (queued.body.startsWith("event:") || queued.body.startsWith("data:")
        ? "text/event-stream"
        : "application/json");
    return new Response(queued.body, {
      status,
      headers: { "content-type": contentType },
    });
  }) as typeof fetch;

  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
