"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { PATH_OVERRIDE_DEFINITIONS, readPathOverrides } = require("./pathOverrides");
const { resolveHome } = require("./paths");

/**
 * Validate non-empty path override values before persisting plugin config.
 *
 * :param config: Plugin config object (normalized or raw).
 * :returns: ``{ ok: true }`` or ``{ ok: false, errors: Array<{ key, message }> }``.
 */
function validatePathOverrides(config) {
  const overrides = readPathOverrides(config);
  const errors = [];

  for (const definition of PATH_OVERRIDE_DEFINITIONS) {
    const rawValue = overrides[definition.key];
    if (typeof rawValue !== "string" || !rawValue.trim()) continue;

    const fieldErrors = validateOverrideValue(definition.key, rawValue.trim());
    errors.push(...fieldErrors);
  }

  if (errors.length === 0) {
    return { ok: true };
  }

  return { ok: false, errors };
}

/**
 * @param {string} key
 * @param {string} rawValue
 * @returns {Array<{ key: string, message: string }>}
 */
function validateOverrideValue(key, rawValue) {
  switch (key) {
    case "CODEX_HOME":
      return validateCodexHome(rawValue);
    case "CLAUDE_CONFIG_DIR":
      return validateClaudeConfigDir(rawValue);
    case "FLEXBAR_AI_CLAUDE_EVENTS":
      return validateClaudeBridgeEventsPath(rawValue);
    default:
      return [];
  }
}

function validateCodexHome(rawValue) {
  const resolved = expandUserPath(rawValue);
  const stat = statPath(resolved);

  if (!stat) {
    return [error("CODEX_HOME", `Codex home does not exist: ${resolved}`)];
  }
  if (!stat.isDirectory()) {
    return [error("CODEX_HOME", `Codex home must be a directory: ${resolved}`)];
  }

  return [];
}

function validateClaudeConfigDir(rawValue) {
  const roots = splitCommaSeparatedPaths(rawValue);
  if (roots.length === 0) {
    return [error("CLAUDE_CONFIG_DIR", "Enter at least one Claude config directory.")];
  }

  const errors = [];

  for (const root of roots) {
    const resolved = expandUserPath(root);
    const stat = statPath(resolved);

    if (!stat) {
      errors.push(error("CLAUDE_CONFIG_DIR", `Claude config directory does not exist: ${resolved}`));
      continue;
    }
    if (!stat.isDirectory()) {
      errors.push(error("CLAUDE_CONFIG_DIR", `Claude config path must be a directory: ${resolved}`));
      continue;
    }

    const projectsDir = path.join(resolved, "projects");
    if (!statPath(projectsDir)?.isDirectory()) {
      errors.push(error(
        "CLAUDE_CONFIG_DIR",
        `Missing projects log directory: ${projectsDir}`
      ));
    }
  }

  return errors;
}

function validateClaudeBridgeEventsPath(rawValue) {
  const resolved = expandUserPath(rawValue);
  const stat = statPath(resolved);

  if (stat?.isDirectory()) {
    return [error("FLEXBAR_AI_CLAUDE_EVENTS", `Bridge events path must be a file, not a directory: ${resolved}`)];
  }
  if (stat?.isFile()) {
    return [];
  }

  const parentDir = path.dirname(resolved);
  const parentStat = statPath(parentDir);
  if (!parentStat?.isDirectory()) {
    return [error(
      "FLEXBAR_AI_CLAUDE_EVENTS",
      `Parent directory does not exist: ${parentDir}`
    )];
  }

  return [];
}

function splitCommaSeparatedPaths(rawValue) {
  return rawValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function expandUserPath(rawValue) {
  const trimmed = rawValue.trim();
  const home = resolveHome();

  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/")) return path.join(home, trimmed.slice(2));
  if (trimmed.startsWith("~")) return path.join(home, trimmed.slice(1));

  return path.resolve(trimmed);
}

function statPath(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function error(key, message) {
  return { key, message };
}

module.exports = {
  expandUserPath,
  validateOverrideValue,
  validatePathOverrides,
};
