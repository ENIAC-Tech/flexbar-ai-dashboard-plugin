"use strict";

const MAX_ACTION_LENGTH = 180;

function summarizeToolAction(toolName, rawInput) {
  const input = parseInput(rawInput);
  let summary = "";

  if (toolName === "apply_patch") {
    summary = summarizePatchFiles(pick(input, ["value", "patch"]) || stringifyShort(input));
  } else if (toolName === "shell_command" || toolName === "Bash") {
    summary = pick(input, ["command", "cmd", "description"]) || stringifyShort(input);
  } else if (toolName === "Read" || toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit") {
    summary = pick(input, ["file_path", "path", "filePath"]) || stringifyShort(input);
  } else if (toolName === "Grep" || toolName === "Glob") {
    const pattern = pick(input, ["pattern", "glob", "query"]);
    const root = pick(input, ["path", "cwd"]);
    summary = [pattern, root].filter(Boolean).join(" in ") || stringifyShort(input);
  } else if (toolName === "web_search_call" || toolName === "web_search") {
    summary = pick(input, ["query", "q"]) || stringifyShort(input);
  } else {
    summary = pick(input, ["command", "file_path", "path", "query", "pattern", "description"]) || stringifyShort(input);
  }

  return truncate(redactSecrets(summary));
}

function summarizePatchFiles(patchText) {
  const files = [];
  const pattern = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm;
  let match;
  while ((match = pattern.exec(patchText)) !== null) {
    files.push(match[1].trim());
  }

  if (files.length === 0) return "patch";
  return Array.from(new Set(files)).join(", ");
}

function summarizeReasoning(entry) {
  const payload = entry && entry.payload || {};
  const candidates = [
    payload.summary,
    payload.text,
    payload.content,
    payload.message,
  ];

  for (const candidate of candidates) {
    const text = stringifyReasoningCandidate(candidate);
    if (text) return truncate(redactSecrets(text));
  }

  return null;
}

function stringifyReasoningCandidate(candidate) {
  if (!candidate) return "";
  if (typeof candidate === "string") return candidate.trim();
  if (Array.isArray(candidate)) {
    return candidate.map(stringifyReasoningCandidate).filter(Boolean).join(" ");
  }
  if (typeof candidate === "object") {
    if (typeof candidate.text === "string") return candidate.text.trim();
    if (typeof candidate.summary === "string") return candidate.summary.trim();
  }
  return "";
}

function parseInput(rawInput) {
  if (!rawInput) return {};
  if (typeof rawInput === "object") return rawInput;
  if (typeof rawInput !== "string") return {};

  try {
    return JSON.parse(rawInput);
  } catch {
    return { value: rawInput };
  }
}

function pick(input, keys) {
  for (const key of keys) {
    if (input && input[key] !== undefined && input[key] !== null && input[key] !== "") {
      return String(input[key]);
    }
  }
  return "";
}

function stringifyShort(input) {
  if (!input || typeof input !== "object" || Object.keys(input).length === 0) return "";
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}

function redactSecrets(value) {
  return String(value)
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, "sk-...redacted")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1...redacted")
    .replace(/(token|api[_-]?key|password|secret)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2...redacted");
}

function truncate(value, maxLength = MAX_ACTION_LENGTH) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

module.exports = {
  summarizeReasoning,
  summarizeToolAction,
};
