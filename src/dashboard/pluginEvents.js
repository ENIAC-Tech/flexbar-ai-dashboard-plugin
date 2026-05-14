"use strict";

const { languageFromPayload } = require("./i18n");

function extractLoadedKeys(payload) {
  const serialNumber = payload && payload.serialNumber || null;
  const keys = firstArray(
    payload && payload.keys,
    payload && payload.page && payload.page.keys,
    payload && payload.data && payload.data.keys,
    payload && payload.data && payload.data.page && payload.data.page.keys
  );

  return {
    serialNumber,
    keys,
  };
}

function extractInteractionKey(payload) {
  return {
    serialNumber: payload && payload.serialNumber || null,
    key: payload && (
      payload.key ||
      payload.data && payload.data.key ||
      payload.userData && payload.userData.key ||
      payload.data && payload.data.userData && payload.data.userData.key
    ) || null,
  };
}

function sessionTitleModeFromKey(key) {
  const data = keyConfigFromKey(key);
  const value = data.sessionTitleMode || data.titleMode;
  return value === "latest" ? "latest" : "initial";
}

function tokenDisplayModeFromKey(key) {
  const data = keyConfigFromKey(key);
  return data.tokenDisplayMode === "recentChart" ? "recentChart" : "summary";
}

function dataSourceFromKey(key) {
  const data = keyConfigFromKey(key);
  return data.dataSource === "claude" ? "claude" : "codex";
}

function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function keyConfigFromKey(key) {
  const data = key && key.data && typeof key.data === "object" && !Array.isArray(key.data)
    ? key.data
    : {};
  const nestedConfig = data.config && typeof data.config === "object" && !Array.isArray(data.config)
    ? data.config
    : {};
  const config = key && key.config && typeof key.config === "object" && !Array.isArray(key.config)
    ? key.config
    : {};
  const rootConfig = rootConfigFromKey(key);
  return {
    ...data,
    ...rootConfig,
    ...nestedConfig,
    ...config,
  };
}

function rootConfigFromKey(key) {
  if (!key || typeof key !== "object" || Array.isArray(key)) return {};

  const config = {};
  for (const name of ["dataSource", "sessionTitleMode", "titleMode", "tokenDisplayMode"]) {
    if (Object.prototype.hasOwnProperty.call(key, name)) {
      config[name] = key[name];
    }
  }
  return config;
}

module.exports = {
  dataSourceFromKey,
  extractInteractionKey,
  extractLoadedKeys,
  languageFromPayload,
  sessionTitleModeFromKey,
  tokenDisplayModeFromKey,
};
