"use strict";

const { execFile } = require("node:child_process");

function createSkillInvocationText(skillName) {
  return `Use the ${String(skillName || "").trim()} skill.`;
}

function createSkillPasteCommand(text, platform = process.platform) {
  if (platform === "win32") return createWindowsPasteCommand(text);
  if (platform === "darwin") {
    return {
      file: "osascript",
      args: [
        "-e",
        "set the clipboard to item 1 of argv",
        "-e",
        "tell application \"System Events\" to keystroke \"v\" using command down",
        text,
      ],
    };
  }
  return {
    file: "sh",
    args: ["-lc", "printf %s \"$1\" | xclip -selection clipboard && xdotool key ctrl+v", "sh", text],
  };
}

function createSkillCopyCommand(text, platform = process.platform) {
  if (platform === "win32") return createWindowsClipboardCommand(text);
  if (platform === "darwin") {
    return {
      file: "osascript",
      args: ["-e", "set the clipboard to item 1 of argv", text],
    };
  }
  return {
    file: "sh",
    args: ["-lc", "printf %s \"$1\" | xclip -selection clipboard", "sh", text],
  };
}

async function applySkillInvocation(options = {}) {
  const skillName = String(options.skillName || "").trim();
  if (!skillName) return { ok: false, action: "none", error: "No skill selected" };

  const platform = options.platform || process.platform;
  const run = options.runCommand || runCommand;
  const text = createSkillInvocationText(skillName);

  try {
    await run(createSkillPasteCommand(text, platform));
    return { ok: true, action: "paste", text };
  } catch (pasteError) {
    try {
      await run(createSkillCopyCommand(text, platform));
      return { ok: true, action: "copy", text, warning: pasteError && pasteError.message };
    } catch (copyError) {
      return { ok: false, action: "none", text, error: copyError && copyError.message || String(copyError) };
    }
  }
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    execFile(command.file, command.args || [], { windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function createWindowsPasteCommand(text) {
  return createWindowsEncodedCommand([
    windowsSetClipboardScript(text),
    "Add-Type -AssemblyName System.Windows.Forms",
    "[System.Windows.Forms.SendKeys]::SendWait('^v')",
  ].join("; "));
}

function createWindowsClipboardCommand(text) {
  return createWindowsEncodedCommand(windowsSetClipboardScript(text));
}

function windowsSetClipboardScript(text) {
  const encodedText = Buffer.from(String(text || ""), "utf16le").toString("base64");
  return `$text = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedText}')); Set-Clipboard -Value $text`;
}

function createWindowsEncodedCommand(script) {
  return {
    file: "powershell.exe",
    args: [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
  };
}

module.exports = {
  applySkillInvocation,
  createSkillCopyCommand,
  createSkillInvocationText,
  createSkillPasteCommand,
};
