"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

test("Rollup patches FlexDesigner reconnect retry to preserve transport context", () => {
  const rollupConfig = fs.readFileSync(path.join(__dirname, "..", "rollup.config.mjs"), "utf8");

  assert.match(rollupConfig, /patchFlexdesignerTransportRetry/);
  assert.match(rollupConfig, /setTimeout\(\(\) => this\.start\(\), 5000\)/);
});

test("bundled plugin does not contain the unbound FlexDesigner reconnect retry", () => {
  const bundle = fs.readFileSync(
    path.join(__dirname, "..", "com.aspen.flexbar-ai-dashboard.plugin", "backend", "plugin.cjs"),
    "utf8"
  );

  assert.doesNotMatch(bundle, /setTimeout\(this\.start, 5000\)/);
});

test("token usage config page exposes recent chart display mode", () => {
  const page = fs.readFileSync(
    path.join(__dirname, "..", "com.aspen.flexbar-ai-dashboard.plugin", "ui", "token-usage.vue"),
    "utf8"
  );

  assert.match(page, /Display mode/);
  assert.match(page, /tokenDisplayMode/);
  assert.match(page, /recentChart/);
});
