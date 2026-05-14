"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSkillInvocationText,
  createSkillPasteCommand,
} = require("../src/dashboard/skillAction");

test("skill action creates a natural invocation prompt", () => {
  assert.equal(createSkillInvocationText("diagnose"), "Use the diagnose skill.");
});

test("skill action creates a Windows paste command", () => {
  const command = createSkillPasteCommand("Use the diagnose skill.", "win32");

  assert.equal(command.file, "powershell.exe");
  assert.ok(command.args.includes("-EncodedCommand"));
});

test("skill action creates a macOS paste command", () => {
  const command = createSkillPasteCommand("Use the diagnose skill.", "darwin");

  assert.equal(command.file, "osascript");
  assert.ok(command.args.includes("Use the diagnose skill."));
});
