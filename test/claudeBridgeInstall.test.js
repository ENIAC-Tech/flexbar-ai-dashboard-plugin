"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getClaudeBridgeStatus,
  installClaudeBridge,
  uninstallClaudeBridge,
} = require("../src/collectors/claudeBridgeInstall");

test("Claude bridge install adds hook handlers without replacing existing hooks", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-ai-"));
  const settingsPath = path.join(tempDir, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "echo existing" }],
        },
      ],
    },
  }, null, 2));

  const result = installClaudeBridge({ home: tempDir, platform: "win32" });
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

  assert.equal(result.installed, true);
  assert.equal(settings.hooks.PreToolUse.length, 2);
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, "echo existing");
  assert.match(settings.hooks.PreToolUse[1].hooks[0].command, /flexbar-ai-dashboard/);
});

test("Windows PowerShell recorder parses JSON without an unsupported -Depth parameter", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-ai-"));
  installClaudeBridge({ home: tempDir, platform: "win32", overwriteStatusLine: true });
  const recorderPath = path.join(tempDir, ".flexbar-ai-dashboard", "claude-bridge-recorder.ps1");
  const recorder = fs.readFileSync(recorderPath, "utf8");

  assert.doesNotMatch(recorder, /ConvertFrom-Json\s+-Depth/);
  assert.match(recorder, /ConvertFrom-Json/);
});

test("Claude bridge install does not overwrite a user statusLine by default", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-ai-"));
  const settingsPath = path.join(tempDir, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({
    statusLine: { type: "command", command: "existing-status" },
  }, null, 2));

  const result = installClaudeBridge({ home: tempDir, platform: "win32" });
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

  assert.equal(result.statusLineInstalled, false);
  assert.equal(result.statusLineConflict, true);
  assert.equal(settings.statusLine.command, "existing-status");
});

test("Claude bridge uninstall removes only Flexbar handlers and preserves user hooks", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-ai-"));
  const settingsPath = path.join(tempDir, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify({
    hooks: {
      Stop: [
        {
          hooks: [{ type: "command", command: "echo existing" }],
        },
      ],
    },
  }, null, 2));

  installClaudeBridge({ home: tempDir, platform: "win32", overwriteStatusLine: true });
  const uninstallResult = uninstallClaudeBridge({ home: tempDir });
  const status = getClaudeBridgeStatus({ home: tempDir });
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));

  assert.equal(uninstallResult.uninstalled, true);
  assert.equal(status.hooksInstalled, false);
  assert.equal(status.statusLineInstalled, false);
  assert.equal(settings.hooks.Stop[0].hooks[0].command, "echo existing");
});
