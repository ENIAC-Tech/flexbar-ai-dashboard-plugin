"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { listAiSkills } = require("../src/collectors/skills");

test("skill collector lists Codex skills from CODEX_HOME", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "skills-codex-"));
  const skillDir = path.join(home, ".codex", "skills", "diagnose");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
    "---",
    "name: diagnose",
    "description: Debug failures systematically",
    "---",
    "",
    "# Diagnose",
  ].join("\n"), "utf8");

  const skills = listAiSkills({
    source: "codex",
    env: { USERPROFILE: home, HOME: home },
  });

  assert.deepEqual(skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    source: skill.source,
  })), [
    {
      name: "diagnose",
      description: "Debug failures systematically",
      source: "codex",
    },
  ]);
});

test("skill collector lists Claude skills from CLAUDE_CONFIG_DIR", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "skills-claude-"));
  const configDir = path.join(home, "claude-config");
  const skillDir = path.join(configDir, "skills", "git-commit");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), [
    "---",
    "name: git-commit",
    "---",
    "",
    "# Git Commit",
  ].join("\n"), "utf8");

  const skills = listAiSkills({
    source: "claude",
    env: { USERPROFILE: home, HOME: home, CLAUDE_CONFIG_DIR: configDir },
  });

  assert.deepEqual(skills.map((skill) => skill.name), ["git-commit"]);
});
