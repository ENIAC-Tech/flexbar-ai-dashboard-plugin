"use strict";

const path = require("node:path");
const {
  resolveClaudeBridgePath,
  resolveClaudeProjectRoots,
  resolveCodexHome,
  resolveHome,
} = require("./paths");

/** @type {ReadonlyArray<{ key: string, label: string, description: string, placeholder: (env: NodeJS.ProcessEnv) => string }>} */
const PATH_OVERRIDE_DEFINITIONS = [
  {
    key: "CODEX_HOME",
    label: "Codex home",
    description: "Overrides CODEX_HOME when set.",
    placeholder: (env) => resolveCodexHome(env),
  },
  {
    key: "CLAUDE_CONFIG_DIR",
    label: "Claude config directories",
    description: "Comma-separated Claude config roots. Project logs are read from <dir>/projects.",
    placeholder: (env) => defaultClaudeConfigDirPlaceholder(env),
  },
  {
    key: "FLEXBAR_AI_CLAUDE_EVENTS",
    label: "Claude bridge events file",
    description: "Overrides FLEXBAR_AI_CLAUDE_EVENTS when set.",
    placeholder: (env) => resolveClaudeBridgePath(env),
  },
];

function unwrapPluginConfigPayload(payload) {
  if (!payload || typeof payload !== "object") return {};

  const hasPluginSettings = "pathOverrides" in payload || "overwriteStatusLine" in payload;
  if (!hasPluginSettings && payload.config && typeof payload.config === "object") {
    return payload.config;
  }

  return payload;
}

function readPathOverrides(config) {
  const root = unwrapPluginConfigPayload(config);
  const overrides = root.pathOverrides && typeof root.pathOverrides === "object"
    ? root.pathOverrides
    : {};
  return overrides;
}

function normalizePluginConfig(config) {
  const root = unwrapPluginConfigPayload(config);
  const overrides = readPathOverrides(root);
  const normalizedOverrides = {};

  for (const definition of PATH_OVERRIDE_DEFINITIONS) {
    const value = overrides[definition.key];
    normalizedOverrides[definition.key] = typeof value === "string" ? value : "";
  }

  const { pathOverrides: _ignored, HOME: _legacyHome, ...rest } = root;

  return {
    ...rest,
    overwriteStatusLine: Boolean(root.overwriteStatusLine),
    pathOverrides: normalizedOverrides,
  };
}

function envWithPathOverrides(config, baseEnv = process.env) {
  const overrides = readPathOverrides(normalizePluginConfig(config));
  const env = { ...baseEnv };

  for (const definition of PATH_OVERRIDE_DEFINITIONS) {
    const value = overrides[definition.key];
    if (typeof value !== "string" || !value.trim()) continue;

    env[definition.key] = value.trim();
  }

  return env;
}

function collectorOptionsFromConfig(config, extra = {}) {
  const env = envWithPathOverrides(config, extra.env || process.env);

  return {
    ...extra,
    env,
    home: resolveHome(env),
    codexHome: resolveCodexHome(env),
    bridgePath: resolveClaudeBridgePath(env),
    claudeProjectRoots: resolveClaudeProjectRoots(env),
  };
}

function listPathDefaults(baseEnv = process.env) {
  return PATH_OVERRIDE_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    description: definition.description,
    resolved: definition.placeholder(baseEnv),
  }));
}

function defaultClaudeConfigDirPlaceholder(env = process.env) {
  if (env.CLAUDE_CONFIG_DIR) return env.CLAUDE_CONFIG_DIR;

  const home = resolveHome(env);
  return [
    path.join(home, ".config", "claude"),
    path.join(home, ".claude"),
  ].join(", ");
}

module.exports = {
  PATH_OVERRIDE_DEFINITIONS,
  collectorOptionsFromConfig,
  envWithPathOverrides,
  listPathDefaults,
  normalizePluginConfig,
  readPathOverrides,
  unwrapPluginConfigPayload,
};
