"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getSetupStatus,
  installAll,
  uninstallAll,
} = require("../src/collectors/setup");

test("one-click install configures Claude bridge and reports Codex local status", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-ai-setup-"));
  fs.mkdirSync(path.join(tempDir, ".codex", "sessions"), { recursive: true });
  fs.writeFileSync(path.join(tempDir, ".codex", "auth.json"), "{}", "utf8");

  const result = installAll({ home: tempDir, platform: "win32", overwriteStatusLine: true });
  const status = getSetupStatus({ home: tempDir });

  assert.equal(result.installed, true);
  assert.equal(result.claude.hooksInstalled, true);
  assert.equal(result.claude.statusLineInstalled, true);
  assert.equal(status.codex.codexHomeExists, true);
  assert.equal(status.codex.authJsonExists, true);
  assert.equal(status.codex.sessionsDirExists, true);
});

test("one-click uninstall removes Claude bridge but does not remove Codex files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-ai-setup-"));
  const codexAuth = path.join(tempDir, ".codex", "auth.json");
  fs.mkdirSync(path.dirname(codexAuth), { recursive: true });
  fs.writeFileSync(codexAuth, "{}", "utf8");

  installAll({ home: tempDir, platform: "win32", overwriteStatusLine: true });
  const result = uninstallAll({ home: tempDir });

  assert.equal(result.uninstalled, true);
  assert.equal(result.claude.hooksInstalled, false);
  assert.equal(fs.existsSync(codexAuth), true);
});
