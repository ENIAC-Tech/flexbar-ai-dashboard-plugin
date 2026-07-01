"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePluginConfig,
  unwrapPluginConfigPayload,
} = require("../src/collectors/pathOverrides");

test("unwrapPluginConfigPayload reads nested FlexDesigner config object", () => {
  const config = unwrapPluginConfigPayload({
    uuid: "com.aspen.flexbar-ai-dashboard",
    config: {
      pathOverrides: { CODEX_HOME: "/tmp/codex" },
    },
  });

  assert.equal(config.pathOverrides.CODEX_HOME, "/tmp/codex");
});

test("normalizePluginConfig drops legacy HOME override key", () => {
  const config = normalizePluginConfig({
    pathOverrides: {
      HOME: "/should-not-persist",
      CODEX_HOME: "/tmp/codex",
    },
  });

  assert.equal(config.pathOverrides.HOME, undefined);
  assert.equal(config.pathOverrides.CODEX_HOME, "/tmp/codex");
});
