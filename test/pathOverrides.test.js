"use strict";

const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { getSetupStatus } = require("../src/collectors/setup");
const {
  collectorOptionsFromConfig,
  envWithPathOverrides,
  listPathDefaults,
  normalizePluginConfig,
} = require("../src/collectors/pathOverrides");

test("path overrides apply CODEX_HOME to collector env", () => {
  const customCodex = path.join(os.tmpdir(), "custom-codex-home");
  const env = envWithPathOverrides({
    pathOverrides: {
      CODEX_HOME: customCodex,
    },
  });

  assert.equal(env.CODEX_HOME, customCodex);
});

test("collector options expose resolved paths from plugin config", () => {
  const customCodex = path.join(os.tmpdir(), "custom-codex");
  const options = collectorOptionsFromConfig({
    pathOverrides: {
      CODEX_HOME: customCodex,
    },
  });

  assert.equal(options.codexHome, customCodex);
});

test("setup status honors codex home override from plugin config", () => {
  const customHome = path.join(os.tmpdir(), "flexbar-path-override-home");
  const status = getSetupStatus(collectorOptionsFromConfig({
    pathOverrides: {
      CODEX_HOME: path.join(customHome, "codex"),
    },
  }));

  assert.equal(status.codex.codexHome, path.join(customHome, "codex"));
});

test("path defaults describe auto-detected resolved values", () => {
  const defaults = listPathDefaults({
    HOME: "/tmp/flexbar-home",
    USERPROFILE: "/tmp/flexbar-home",
    CODEX_HOME: "/tmp/flexbar-codex",
  });

  const codex = defaults.find((item) => item.key === "CODEX_HOME");
  assert.equal(codex.resolved, "/tmp/flexbar-codex");
});

test("normalizePluginConfig fills missing override keys", () => {
  const config = normalizePluginConfig({
    overwriteStatusLine: true,
    pathOverrides: {
      CODEX_HOME: "/tmp/codex",
    },
  });

  assert.equal(config.overwriteStatusLine, true);
  assert.equal(config.pathOverrides.CODEX_HOME, "/tmp/codex");
  assert.equal(config.pathOverrides.HOME, undefined);
  assert.equal(config.pathOverrides.CLAUDE_CONFIG_DIR, "");
});
