"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { validatePathOverrides } = require("../src/collectors/pathOverrideValidation");

test("validatePathOverrides accepts empty overrides", () => {
  assert.deepEqual(validatePathOverrides({ pathOverrides: {} }), { ok: true });
});

test("validatePathOverrides requires existing Codex home directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-codex-"));
  const missing = path.join(tempDir, "missing-codex");

  assert.deepEqual(
    validatePathOverrides({ pathOverrides: { CODEX_HOME: missing } }),
    {
      ok: false,
      errors: [{
        key: "CODEX_HOME",
        message: `Codex home does not exist: ${missing}`,
      }],
    }
  );

  fs.mkdirSync(missing, { recursive: true });
  assert.deepEqual(
    validatePathOverrides({ pathOverrides: { CODEX_HOME: missing } }),
    { ok: true }
  );
});

test("validatePathOverrides rejects Codex home when path is a file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-codex-file-"));
  const filePath = path.join(tempDir, "not-a-dir");
  fs.writeFileSync(filePath, "", "utf8");

  const result = validatePathOverrides({ pathOverrides: { CODEX_HOME: filePath } });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /must be a directory/);
});

test("validatePathOverrides requires Claude config roots and projects directories", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-claude-"));
  const configRoot = path.join(tempDir, "claude-config");
  fs.mkdirSync(configRoot, { recursive: true });

  const missingProjects = validatePathOverrides({
    pathOverrides: { CLAUDE_CONFIG_DIR: configRoot },
  });
  assert.equal(missingProjects.ok, false);
  assert.match(missingProjects.errors[0].message, /Missing projects log directory/);

  fs.mkdirSync(path.join(configRoot, "projects"), { recursive: true });
  assert.deepEqual(
    validatePathOverrides({ pathOverrides: { CLAUDE_CONFIG_DIR: configRoot } }),
    { ok: true }
  );
});

test("validatePathOverrides accepts comma-separated Claude config roots when each has projects", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-claude-multi-"));
  const first = path.join(tempDir, "first");
  const second = path.join(tempDir, "second");
  for (const root of [first, second]) {
    fs.mkdirSync(path.join(root, "projects"), { recursive: true });
  }

  assert.deepEqual(
    validatePathOverrides({
      pathOverrides: { CLAUDE_CONFIG_DIR: `${first}, ${second}` },
    }),
    { ok: true }
  );
});

test("validatePathOverrides accepts existing Claude bridge file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-bridge-file-"));
  const bridgeFile = path.join(tempDir, "events.jsonl");
  fs.writeFileSync(bridgeFile, "", "utf8");

  assert.deepEqual(
    validatePathOverrides({ pathOverrides: { FLEXBAR_AI_CLAUDE_EVENTS: bridgeFile } }),
    { ok: true }
  );
});

test("validatePathOverrides accepts new Claude bridge file when parent directory exists", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-bridge-parent-"));
  const bridgeFile = path.join(tempDir, "nested", "events.jsonl");
  fs.mkdirSync(path.dirname(bridgeFile), { recursive: true });

  assert.deepEqual(
    validatePathOverrides({ pathOverrides: { FLEXBAR_AI_CLAUDE_EVENTS: bridgeFile } }),
    { ok: true }
  );
});

test("validatePathOverrides rejects Claude bridge path when parent directory is missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-bridge-missing-"));
  const bridgeFile = path.join(tempDir, "missing-parent", "events.jsonl");

  const result = validatePathOverrides({
    pathOverrides: { FLEXBAR_AI_CLAUDE_EVENTS: bridgeFile },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /Parent directory does not exist/);
});

test("validatePathOverrides rejects Claude bridge path when target is a directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-bridge-dir-"));

  const result = validatePathOverrides({
    pathOverrides: { FLEXBAR_AI_CLAUDE_EVENTS: tempDir },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /must be a file/);
});
