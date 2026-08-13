import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  emitDiagnostic,
  initDiskLog,
  LOG_RETENTION_DAYS,
  MAX_DISK_LOG_BYTES,
} from "../logging.ts";
import { MAX_DIAGNOSTIC_CHARS } from "../observability.ts";

const tempDirs: string[] = [];

function createTempConfig(): { root: string; configPath: string; logsDir: string } {
  const root = mkdtempSync(join(tmpdir(), "llmtf-gateway-log-"));
  tempDirs.push(root);
  const logsDir = join(root, "logs");
  mkdirSync(logsDir, { recursive: true });
  return {
    root,
    configPath: join(root, "gateway-config.json"),
    logsDir,
  };
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("gateway disk logging", () => {
  test("removes daily logs older than the retention window", () => {
    const { configPath, logsDir } = createTempConfig();
    const oldFile = join(logsDir, "gateway-20000101.jsonl");
    writeFileSync(oldFile, '{"level":"warn"}\n');
    const oldTime = new Date(
      Date.now() - (LOG_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1_000,
    );
    utimesSync(oldFile, oldTime, oldTime);

    initDiskLog(configPath);

    expect(existsSync(oldFile)).toBe(false);
  });

  test("bounds diagnostic lines and keeps one size-rotation backup", () => {
    const { configPath, logsDir } = createTempConfig();
    initDiskLog(configPath);

    const message = `[gateway] ${"x".repeat(MAX_DIAGNOSTIC_CHARS * 2)}`;
    const writes = Math.ceil(MAX_DISK_LOG_BYTES / MAX_DIAGNOSTIC_CHARS) + 8;
    for (let index = 0; index < writes; index += 1) {
      emitDiagnostic(`${message}-${index}`);
    }

    const files = readdirSync(logsDir)
      .filter((name) => /^gateway-\d{8}(?:\.1)?\.jsonl$/.test(name))
      .sort();
    expect(files).toHaveLength(2);
    expect(files.some((name) => name.endsWith(".1.jsonl"))).toBe(true);
    for (const name of files) {
      expect(statSync(join(logsDir, name)).size).toBeLessThanOrEqual(
        MAX_DISK_LOG_BYTES,
      );
    }

    const active = files.find((name) => !name.endsWith(".1.jsonl"))!;
    const lines = readFileSync(join(logsDir, active), "utf8")
      .trim()
      .split("\n");
    for (const line of lines) {
      const record = JSON.parse(line) as { message: string };
      expect(record.message.length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_CHARS);
    }
    expect(basename(active)).toMatch(/^gateway-\d{8}\.jsonl$/);
  });

  test("drops a record instead of exceeding the cap when rotation fails", () => {
    const { configPath, logsDir } = createTempConfig();
    initDiskLog(configPath);
    emitDiagnostic("[gateway] seed");

    const active = readdirSync(logsDir).find((name) =>
      /^gateway-\d{8}\.jsonl$/.test(name),
    )!;
    const activePath = join(logsDir, active);
    writeFileSync(activePath, "x".repeat(MAX_DISK_LOG_BYTES - 1));
    mkdirSync(join(logsDir, active.replace(".jsonl", ".1.jsonl")));

    emitDiagnostic("[gateway] this record requires rotation");

    expect(statSync(activePath).size).toBe(MAX_DISK_LOG_BYTES - 1);
  });
});
