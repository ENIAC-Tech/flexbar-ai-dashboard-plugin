"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  getClaudeBridgeStatus,
  installClaudeBridge,
  uninstallClaudeBridge,
} = require("./claudeBridgeInstall");
const {
  resolveClaudeBridgePath,
  resolveClaudeProjectRoots,
  resolveCodexHome,
  resolveHome,
} = require("./paths");

function getSetupStatus(options = {}) {
  const env = buildEnv(options);
  const home = options.home || resolveHome(env);
  const codexHome = options.codexHome || resolveCodexHome(env);
  const claudeRoots = options.claudeProjectRoots || resolveClaudeProjectRoots(env);
  const bridgePath = options.bridgePath || resolveClaudeBridgePath(env);

  return {
    installed: false,
    codex: {
      codexHome,
      codexHomeExists: exists(codexHome),
      authJsonPath: path.join(codexHome, "auth.json"),
      authJsonExists: exists(path.join(codexHome, "auth.json")),
      sessionsDir: path.join(codexHome, "sessions"),
      sessionsDirExists: exists(path.join(codexHome, "sessions")),
    },
    claude: {
      projectRoots: claudeRoots,
      projectRootsExisting: claudeRoots.filter(exists),
      bridgePath,
      ...getClaudeBridgeStatus({ ...options, home }),
    },
  };
}

function installAll(options = {}) {
  const env = buildEnv(options);
  const home = options.home || resolveHome(env);
  const bridgePath = options.bridgePath || resolveClaudeBridgePath(env);
  ensureParentDir(bridgePath);

  const claude = installClaudeBridge({
    ...options,
    home,
    eventPath: bridgePath,
  });
  const status = getSetupStatus({ ...options, home, bridgePath });

  return {
    installed: true,
    codex: status.codex,
    claude,
    warnings: buildWarnings(status, claude),
  };
}

function uninstallAll(options = {}) {
  const env = buildEnv(options);
  const home = options.home || resolveHome(env);
  const claude = uninstallClaudeBridge({ ...options, home });
  const status = getSetupStatus({ ...options, home });

  return {
    uninstalled: true,
    codex: status.codex,
    claude,
    warnings: buildWarnings(status, claude),
  };
}

function buildWarnings(status, claude) {
  const warnings = [];
  if (!status.codex.codexHomeExists) {
    warnings.push("Codex home was not found. Codex local data will be unavailable until Codex has run once.");
  }
  if (!status.codex.sessionsDirExists) {
    warnings.push("Codex sessions directory was not found. Session activity will be unavailable until Codex creates session logs.");
  }
  if (claude.statusLineConflict) {
    warnings.push("Claude already has a statusLine. Hooks were installed, but statusLine was left unchanged.");
  }
  if (status.claude.projectRootsExisting.length === 0) {
    warnings.push("No Claude project log directory was found. Claude usage will be unavailable until Claude Code creates project logs.");
  }
  return warnings;
}

function buildEnv(options) {
  if (!options.home) return options.env || process.env;

  return {
    ...(options.env || process.env),
    USERPROFILE: options.home,
    HOME: options.home,
  };
}

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

module.exports = {
  getSetupStatus,
  installAll,
  uninstallAll,
};
