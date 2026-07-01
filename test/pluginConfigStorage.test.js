"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { getSetupStatus } = require("../src/collectors/setup");
const { collectorOptionsFromConfig } = require("../src/collectors/pathOverrides");
const {
  loadPluginConfigState,
  mergePluginConfigs,
  readPluginConfigFile,
  writePluginConfigFile,
} = require("../src/collectors/pluginConfigStorage");

test("plugin config file round-trips path overrides", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-plugin-config-"));
  const codexHome = path.join(tempDir, "codex");

  fs.mkdirSync(codexHome, { recursive: true });
  writePluginConfigFile(tempDir, {
    pathOverrides: { CODEX_HOME: codexHome },
  });

  const loaded = readPluginConfigFile(tempDir);
  assert.equal(loaded.pathOverrides.CODEX_HOME, codexHome);
});

test("loadPluginConfigState reads config before collector setup uses overrides", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "flexbar-plugin-load-"));
  const codexHome = path.join(tempDir, "codex");
  fs.mkdirSync(codexHome, { recursive: true });

  writePluginConfigFile(tempDir, {
    pathOverrides: { CODEX_HOME: codexHome },
  });

  const { config } = loadPluginConfigState(tempDir);
  const status = getSetupStatus(collectorOptionsFromConfig(config));

  assert.equal(status.codex.codexHome, codexHome);
});

test("mergePluginConfigs keeps disk overrides when host config is empty", () => {
  const merged = mergePluginConfigs(
    { pathOverrides: { CODEX_HOME: "/disk/codex" } },
    { pathOverrides: { CODEX_HOME: "" } }
  );

  assert.equal(merged.pathOverrides.CODEX_HOME, "/disk/codex");
});

test("mergePluginConfigs keeps overwriteStatusLine when host config omits it", () => {
  const merged = mergePluginConfigs(
    { overwriteStatusLine: true },
    { pathOverrides: { CODEX_HOME: "" } }
  );

  assert.equal(merged.overwriteStatusLine, true);
});

test("mergePluginConfigs applies non-empty host overrides on top of disk config", () => {
  const merged = mergePluginConfigs(
    { pathOverrides: { CODEX_HOME: "/disk/codex" } },
    { pathOverrides: { CODEX_HOME: "/host/codex" } }
  );

  assert.equal(merged.pathOverrides.CODEX_HOME, "/host/codex");
});
