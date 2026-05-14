"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  dataSourceFromKey,
  extractInteractionKey,
  extractLoadedKeys,
  languageFromPayload,
  sessionTitleModeFromKey,
  tokenDisplayModeFromKey,
} = require("../src/dashboard/pluginEvents");

test("plugin event adapter extracts keys from plugin.alive and device.newPage payloads", () => {
  const key = { uid: 1, cid: "com.aspen.flexbar-ai-dashboard.session" };

  assert.deepEqual(extractLoadedKeys({ serialNumber: "s1", keys: [key] }), {
    serialNumber: "s1",
    keys: [key],
  });
  assert.deepEqual(extractLoadedKeys({ serialNumber: "s1", page: { keys: [key] } }), {
    serialNumber: "s1",
    keys: [key],
  });
});

test("plugin event adapter extracts clicked keys from plugin.data and device.userData payloads", () => {
  const key = { uid: 2, cid: "com.aspen.flexbar-ai-dashboard.token-usage" };

  assert.deepEqual(extractInteractionKey({ serialNumber: "s1", data: { key } }), {
    serialNumber: "s1",
    key,
  });
  assert.deepEqual(extractInteractionKey({ serialNumber: "s1", key }), {
    serialNumber: "s1",
    key,
  });
});

test("plugin event adapter ignores malformed lifecycle payloads", () => {
  assert.deepEqual(extractLoadedKeys(null), { serialNumber: null, keys: [] });
  assert.deepEqual(extractLoadedKeys({ serialNumber: "s1" }), { serialNumber: "s1", keys: [] });
  assert.equal(extractInteractionKey({ serialNumber: "s1", data: {} }).key, null);
});

test("plugin event adapter reads key data source with codex default", () => {
  assert.equal(dataSourceFromKey({ data: { dataSource: "claude" } }), "claude");
  assert.equal(dataSourceFromKey({ config: { dataSource: "claude" } }), "claude");
  assert.equal(dataSourceFromKey({ data: { config: { dataSource: "claude" } } }), "claude");
  assert.equal(dataSourceFromKey({ dataSource: "claude", data: { dataSource: "codex" } }), "claude");
  assert.equal(dataSourceFromKey({ data: { dataSource: "codex" } }), "codex");
  assert.equal(dataSourceFromKey({ data: { dataSource: "unknown" } }), "codex");
  assert.equal(dataSourceFromKey(null), "codex");
});

test("plugin event adapter reads session title mode with initial default", () => {
  assert.equal(sessionTitleModeFromKey({ data: { sessionTitleMode: "latest" } }), "latest");
  assert.equal(sessionTitleModeFromKey({ config: { sessionTitleMode: "latest" } }), "latest");
  assert.equal(sessionTitleModeFromKey({ data: { sessionTitleMode: "initial" } }), "initial");
  assert.equal(sessionTitleModeFromKey(null), "initial");
});

test("plugin event adapter reads token display mode with summary default", () => {
  assert.equal(tokenDisplayModeFromKey({ data: { tokenDisplayMode: "recentChart" } }), "recentChart");
  assert.equal(tokenDisplayModeFromKey({ config: { tokenDisplayMode: "recentChart" } }), "recentChart");
  assert.equal(tokenDisplayModeFromKey({ data: { tokenDisplayMode: "summary" } }), "summary");
  assert.equal(tokenDisplayModeFromKey({ data: { tokenDisplayMode: "unknown" } }), "summary");
  assert.equal(tokenDisplayModeFromKey(null), "summary");
});

test("plugin event adapter extracts host language from common payload shapes", () => {
  assert.equal(languageFromPayload({ language: "zh-CN" }), "zh");
  assert.equal(languageFromPayload({ locale: "zh_Hans" }), "zh");
  assert.equal(languageFromPayload({ host: { locale: "zh-TW" } }), "zh");
  assert.equal(languageFromPayload({ data: { app: { language: "en-US" } } }), "en");
  assert.equal(languageFromPayload({ config: { language: "fr-FR" } }), "en");
  assert.equal(languageFromPayload(null), null);
});
