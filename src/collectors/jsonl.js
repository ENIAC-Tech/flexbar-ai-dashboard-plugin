"use strict";

const fs = require("node:fs");
const path = require("node:path");

function pathExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function walkJsonlFiles(root) {
  if (!root || !pathExists(root)) return [];

  const files = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  }

  return files.sort((a, b) => {
    const aTime = safeMtimeMs(a);
    const bTime = safeMtimeMs(b);
    return bTime - aTime || a.localeCompare(b);
  });
}

function safeMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function readJsonlTail(filePath, maxLines = 200) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/).filter(Boolean);
  return lines.slice(-maxLines).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function readJsonlFiles(files, maxLinesPerFile = 200) {
  return files.flatMap((filePath) => {
    return readJsonlTail(filePath, maxLinesPerFile).map((entry) => ({
      filePath,
      entry,
    }));
  });
}

function latestFile(files) {
  return files[0] || null;
}

module.exports = {
  latestFile,
  pathExists,
  readJsonlFiles,
  readJsonlTail,
  safeMtimeMs,
  walkJsonlFiles,
};
