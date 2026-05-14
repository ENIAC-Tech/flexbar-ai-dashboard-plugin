"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  configureDefaultSkillKey,
  skillNameFromKey,
  updateSkillConfigModel,
} = require("../src/dashboard/skillKey");

test("skill config update supports full key model and syncs title", () => {
  const next = updateSkillConfigModel({
    title: "AI Skill",
    config: {
      dataSource: "codex",
      skillName: "",
    },
  }, {
    skillName: "diagnose",
  });

  assert.deepEqual(next.config, {
    dataSource: "codex",
    skillName: "diagnose",
  });
  assert.equal(next.title, "diagnose");
});

test("skill config update supports full key model with data field", () => {
  const next = updateSkillConfigModel({
    cid: "com.aspen.flexbar-ai-dashboard.skill",
    title: "AI Skill",
    data: {
      dataSource: "codex",
      skillName: "",
    },
  }, {
    skillName: "triage",
  });

  assert.deepEqual(next.data, {
    dataSource: "codex",
    skillName: "triage",
  });
  assert.equal(next.title, "triage");
});

test("skill config update preserves legacy data-only model shape", () => {
  assert.deepEqual(updateSkillConfigModel({
    dataSource: "codex",
    skillName: "",
  }, {
    skillName: "git-commit",
  }), {
    dataSource: "codex",
    skillName: "git-commit",
  });
});

test("skill name reader accepts saved skillName from data or config", () => {
  assert.equal(skillNameFromKey({ data: { skillName: "diagnose" } }), "diagnose");
  assert.equal(skillNameFromKey({ config: { skillName: "git-commit" } }), "git-commit");
  assert.equal(skillNameFromKey({ data: { config: { skillName: "triage" } } }), "triage");
});

test("default skill key hides icon when title is the selected skill", () => {
  const key = {
    title: "AI Skill",
    data: { skillName: "diagnose" },
    style: {
      icon: "mdi mdi-star-four-points",
      showIcon: false,
      showTitle: false,
    },
  };

  configureDefaultSkillKey(key, "Select skill");

  assert.equal(key.title, "diagnose");
  assert.equal(key.style.showIcon, false);
  assert.equal(key.style.showTitle, true);
  assert.equal(key.style.showImage, false);
});

test("default skill key keeps icon when no skill is selected", () => {
  const key = {
    title: "AI Skill",
    data: { skillName: "" },
    style: {
      icon: "mdi mdi-star-four-points",
      showIcon: false,
      showTitle: false,
    },
  };

  configureDefaultSkillKey(key, "Select skill");

  assert.equal(key.title, "Select skill");
  assert.equal(key.style.showIcon, true);
  assert.deepEqual(key.style.iconPos, { X: 50, Y: 50 });
  assert.equal(key.style.showTitle, true);
  assert.equal(key.style.showImage, false);
});
