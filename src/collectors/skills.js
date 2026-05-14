"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveCodexHome, resolveHome } = require("./paths");

function listAiSkills(options = {}) {
  const source = options.source === "claude" ? "claude" : "codex";
  const roots = options.roots || skillRoots(source, options.env || process.env);
  const byName = new Map();

  for (const root of roots) {
    for (const filePath of walkSkillFiles(root)) {
      const skill = readSkillFile(filePath, source, root);
      if (skill && !byName.has(skill.name)) byName.set(skill.name, skill);
    }
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function skillRoots(source, env = process.env) {
  if (source === "claude") return claudeSkillRoots(env);

  const codexHome = resolveCodexHome(env);
  return [
    path.join(codexHome, "skills"),
    path.join(codexHome, "plugins", "cache"),
  ];
}

function claudeSkillRoots(env = process.env) {
  const home = resolveHome(env);
  if (env.CLAUDE_CONFIG_DIR) {
    return env.CLAUDE_CONFIG_DIR.split(",")
      .map((root) => root.trim())
      .filter(Boolean)
      .map((root) => path.join(root, "skills"));
  }
  return [path.join(home, ".claude", "skills")];
}

function walkSkillFiles(root, maxDepth = 8) {
  const results = [];
  walk(root, 0);
  return results;

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some((entry) => entry.isFile() && entry.name === "SKILL.md")) {
      results.push(path.join(dir, "SKILL.md"));
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "node_modules") continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  }
}

function readSkillFile(filePath, source, root) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const meta = parseFrontMatter(content);
  const fallbackName = path.basename(path.dirname(filePath));
  const name = String(meta.name || fallbackName).trim();
  if (!name) return null;

  return {
    name,
    description: String(meta.description || "").trim(),
    source,
    path: filePath,
    root,
  };
}

function parseFrontMatter(content) {
  const match = String(content || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const parts = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!parts) continue;
    meta[parts[1]] = parts[2].replace(/^["']|["']$/g, "").trim();
  }
  return meta;
}

module.exports = {
  listAiSkills,
  parseFrontMatter,
};
