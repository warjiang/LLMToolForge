import { describe, expect, test } from "bun:test";

import {
  formatGatewayDiagnostic,
  MAX_DIAGNOSTIC_CHARS,
  streamLogStatus,
} from "../observability.ts";

describe("formatGatewayDiagnostic", () => {
  test("keeps allowlisted technical diagnostics", () => {
    expect(
      formatGatewayDiagnostic([
        "retryRequest error:",
        new Error("socket connection was closed unexpectedly"),
      ]),
    ).toContain("socket connection was closed unexpectedly");
    expect(
      formatGatewayDiagnostic([
        "tryTargetsRecursively error:",
        "upstream unavailable",
        undefined,
      ]),
    ).toContain("upstream unavailable");
    expect(
      formatGatewayDiagnostic([
        "Error during stream processing:",
        "openai",
        new Error("stream failed"),
      ]),
    ).toContain("stream failed");
    expect(formatGatewayDiagnostic(["Failed to parse JSON"])).toBe(
      "Failed to parse JSON",
    );
    expect(formatGatewayDiagnostic(["[gateway] listening"])).toBe(
      "[gateway] listening",
    );
  });

  test("drops raw chunks and arbitrary console payloads", () => {
    const diagnostic = formatGatewayDiagnostic([
      "Error parsing provider stream chunk:",
      new Error("invalid frame"),
      "Chunk:",
      "private model output",
      { headers: { authorization: "Bearer secret" } },
    ]);

    expect(diagnostic).toContain("invalid frame");
    expect(diagnostic).not.toContain("private model output");
    expect(diagnostic).not.toContain("authorization");
    expect(formatGatewayDiagnostic(["unrelated warning", { secret: "value" }])).toBeNull();
  });

  test("keeps safe scalar context but stops before a raw chunk marker", () => {
    const diagnostic = formatGatewayDiagnostic([
      "Error parsing provider stream chunk:",
      new SyntaxError("unexpected token"),
      "Chunk:",
      "private model output",
    ]);

    expect(diagnostic).toContain("unexpected token");
    expect(diagnostic).not.toContain("Chunk:");
    expect(diagnostic).not.toContain("private model output");
  });

  test("redacts credentials and bounds the resulting line", () => {
    const diagnostic = formatGatewayDiagnostic([
      "[gateway] failed",
      new Error(`authorization=Bearer abc123 token=xyz ${"x".repeat(10_000)}`),
    ]);

    expect(diagnostic).not.toContain("abc123");
    expect(diagnostic).not.toContain("xyz");
    expect(diagnostic).toContain("[redacted]");
    expect(diagnostic!.length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_CHARS);
  });
});

describe("streamLogStatus", () => {
  test("preserves success and distinguishes upstream failures from cancellation", () => {
    expect(streamLogStatus(201, "success")).toBe(201);
    expect(streamLogStatus(200, "upstream_error")).toBe(502);
    expect(streamLogStatus(200, "client_cancelled")).toBe(499);
  });
});
