import { describe, expect, test } from "vitest";
import {
  AGENT_ERR_UPSTREAM_BAD_RESPONSE,
  AGENT_ERR_UPSTREAM_INTERRUPTED,
  classifyAgentError,
  normalizeAgentErrorMessage,
} from "../agentError";

describe("classifyAgentError", () => {
  test("maps Tauri dropped streaming-body resource id to interrupted", () => {
    expect(classifyAgentError("The resource id 3309130990 is invalid.")).toBe(
      AGENT_ERR_UPSTREAM_INTERRUPTED
    );
  });

  test("maps unexpectedly-closed socket to interrupted", () => {
    expect(
      classifyAgentError(
        "The socket connection was closed unexpectedly. For more information, pass `verbose: true`"
      )
    ).toBe(AGENT_ERR_UPSTREAM_INTERRUPTED);
  });

  test("maps a generic closed connection to interrupted", () => {
    expect(classifyAgentError("Connection closed while reading")).toBe(
      AGENT_ERR_UPSTREAM_INTERRUPTED
    );
  });

  test("maps unparseable upstream JSON to bad response", () => {
    expect(classifyAgentError("Failed to parse JSON")).toBe(
      AGENT_ERR_UPSTREAM_BAD_RESPONSE
    );
  });

  test("is case-insensitive", () => {
    expect(classifyAgentError("THE RESOURCE ID 42 IS INVALID.")).toBe(
      AGENT_ERR_UPSTREAM_INTERRUPTED
    );
  });

  test("returns null for unrelated errors so the raw text is shown", () => {
    expect(classifyAgentError("未找到模型：foo")).toBeNull();
    expect(classifyAgentError("")).toBeNull();
    expect(classifyAgentError("Something entirely different")).toBeNull();
  });

  test("does not misclassify a non-numeric resource message", () => {
    expect(classifyAgentError("The resource is invalid")).toBeNull();
  });
});

describe("normalizeAgentErrorMessage", () => {
  const translate = (key: string) => `[${key}]`;

  test("localizes gateway failures for the built-in runtime", () => {
    expect(
      normalizeAgentErrorMessage(
        "Connection closed while reading",
        translate,
        true,
      ),
    ).toBe(`[${AGENT_ERR_UPSTREAM_INTERRUPTED}]`);
  });

  test("keeps external AAP runtime errors verbatim", () => {
    expect(
      normalizeAgentErrorMessage(
        "Connection closed while reading",
        translate,
        false,
      ),
    ).toBe("Connection closed while reading");
    expect(
      normalizeAgentErrorMessage("Failed to parse JSON", translate, false),
    ).toBe("Failed to parse JSON");
  });

  test("still strips wrapping quotes and localizes cancellation", () => {
    expect(
      normalizeAgentErrorMessage('"Request cancelled"', translate, false),
    ).toBe("[agent_request_cancelled]");
  });
});
