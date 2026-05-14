"use strict";

const os = require("node:os");
const path = require("node:path");
const { pathExists } = require("./jsonl");

function resolveHome(env = process.env) {
  return env.USERPROFILE || env.HOME || os.homedir();
}

function resolveCodexHome(env = process.env) {
  return env.CODEX_HOME || path.join(resolveHome(env), ".codex");
}

function resolveClaudeProjectRoots(env = process.env) {
  if (env.CLAUDE_CONFIG_DIR) {
    return env.CLAUDE_CONFIG_DIR.split(",")
      .map((root) => root.trim())
      .filter(Boolean)
      .map((root) => path.join(root, "projects"));
  }

  const home = resolveHome(env);
  return [
    path.join(home, ".config", "claude", "projects"),
    path.join(home, ".claude", "projects"),
  ];
}

function resolveClaudeBridgePath(env = process.env) {
  return env.FLEXBAR_AI_CLAUDE_EVENTS ||
    path.join(resolveHome(env), ".flexbar-ai-dashboard", "claude-events.jsonl");
}

function firstExisting(paths) {
  return paths.find(pathExists) || null;
}

module.exports = {
  firstExisting,
  resolveClaudeBridgePath,
  resolveClaudeProjectRoots,
  resolveCodexHome,
  resolveHome,
};
