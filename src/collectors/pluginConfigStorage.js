"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizePluginConfig, readPathOverrides } = require("./pathOverrides");

function pluginConfigPath(pluginDirectory) {
  if (!pluginDirectory) return null;
  return path.join(pluginDirectory, "config.json");
}

function readPluginConfigFile(pluginDirectory) {
  const configPath = pluginConfigPath(pluginDirectory);
  if (!configPath || !fs.existsSync(configPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return normalizePluginConfig(raw);
  } catch (error) {
    return {
      error: error && error.message ? error.message : String(error),
      path: configPath,
    };
  }
}

function writePluginConfigFile(pluginDirectory, config) {
  const configPath = pluginConfigPath(pluginDirectory);
  if (!configPath) return false;

  const normalized = normalizePluginConfig(config);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return true;
}

function mergePluginConfigs(baseConfig, nextConfig) {
  const base = normalizePluginConfig(baseConfig);
  const next = normalizePluginConfig(nextConfig);
  const baseOverrides = readPathOverrides(base);
  const nextOverrides = readPathOverrides(next);
  const pathOverrides = { ...baseOverrides };

  for (const [key, value] of Object.entries(nextOverrides)) {
    if (typeof value === "string" && value.trim()) {
      pathOverrides[key] = value.trim();
    }
  }

  return normalizePluginConfig({
    overwriteStatusLine: typeof next.overwriteStatusLine === "boolean"
      ? next.overwriteStatusLine
      : base.overwriteStatusLine,
    pathOverrides,
  });
}

function loadPluginConfigState(pluginDirectory) {
  const fromDisk = readPluginConfigFile(pluginDirectory);
  if (fromDisk && fromDisk.error) {
    return {
      config: normalizePluginConfig({}),
      warning: `Failed to read plugin config file: ${fromDisk.error}`,
    };
  }

  return {
    config: normalizePluginConfig(fromDisk || {}),
    warning: null,
  };
}

module.exports = {
  loadPluginConfigState,
  mergePluginConfigs,
  pluginConfigPath,
  readPluginConfigFile,
  writePluginConfigFile,
};
