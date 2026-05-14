"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MANAGED_MARKER = "flexbar-ai-dashboard";
const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "PermissionRequest",
  "PermissionDenied",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "Stop",
  "StopFailure",
  "SessionEnd",
  "PreCompact",
  "PostCompact",
];

function getClaudeBridgeStatus(options = {}) {
  const paths = resolveBridgePaths(options);
  const settings = readSettings(paths.settingsPath);
  return {
    settingsPath: paths.settingsPath,
    bridgeDir: paths.bridgeDir,
    eventPath: paths.eventPath,
    recorderPath: paths.recorderPath,
    settingsExists: fs.existsSync(paths.settingsPath),
    recorderExists: fs.existsSync(paths.recorderPath),
    eventFileExists: fs.existsSync(paths.eventPath),
    hooksInstalled: hasManagedHooks(settings),
    statusLineInstalled: isManagedStatusLine(settings.statusLine),
    statusLineConflict: Boolean(settings.statusLine && !isManagedStatusLine(settings.statusLine)),
    hookEvents: Object.keys(settings.hooks || {}).filter((eventName) => {
      return (settings.hooks[eventName] || []).some(groupHasManagedHook);
    }),
  };
}

function installClaudeBridge(options = {}) {
  const paths = resolveBridgePaths(options);
  const settings = readSettings(paths.settingsPath);
  const beforeStatusLine = settings.statusLine;

  fs.mkdirSync(paths.bridgeDir, { recursive: true });
  fs.mkdirSync(path.dirname(paths.settingsPath), { recursive: true });
  writeRecorder(paths.recorderPath, options.platform || process.platform);

  settings.hooks = settings.hooks && typeof settings.hooks === "object" ? settings.hooks : {};
  for (const eventName of HOOK_EVENTS) {
    installEventHook(settings.hooks, eventName, buildHookHandler(eventName, paths, options.platform || process.platform));
  }

  const statusLineConflict = Boolean(beforeStatusLine && !isManagedStatusLine(beforeStatusLine));
  let statusLineInstalled = false;
  if (!statusLineConflict || options.overwriteStatusLine) {
    settings.statusLine = buildStatusLine(paths, options.platform || process.platform);
    statusLineInstalled = true;
  }

  writeJsonFile(paths.settingsPath, settings);

  return {
    installed: true,
    hooksInstalled: true,
    statusLineInstalled,
    statusLineConflict: statusLineConflict && !options.overwriteStatusLine,
    ...getClaudeBridgeStatus(options),
  };
}

function uninstallClaudeBridge(options = {}) {
  const paths = resolveBridgePaths(options);
  const settings = readSettings(paths.settingsPath);

  if (settings.hooks && typeof settings.hooks === "object") {
    for (const eventName of Object.keys(settings.hooks)) {
      settings.hooks[eventName] = removeManagedGroups(settings.hooks[eventName]);
      if (settings.hooks[eventName].length === 0) {
        delete settings.hooks[eventName];
      }
    }
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }
  }

  if (isManagedStatusLine(settings.statusLine)) {
    delete settings.statusLine;
  }

  writeJsonFile(paths.settingsPath, settings);

  return {
    uninstalled: true,
    ...getClaudeBridgeStatus(options),
  };
}

function resolveBridgePaths(options = {}) {
  const home = options.home || process.env.USERPROFILE || process.env.HOME || os.homedir();
  const bridgeDir = options.bridgeDir || path.join(home, ".flexbar-ai-dashboard");
  const settingsPath = options.settingsPath || path.join(home, ".claude", "settings.json");
  const eventPath = options.eventPath || path.join(bridgeDir, "claude-events.jsonl");
  const platform = options.platform || process.platform;
  const recorderPath = options.recorderPath ||
    path.join(bridgeDir, platform === "win32" ? "claude-bridge-recorder.ps1" : "claude-bridge-recorder.cjs");

  return {
    bridgeDir,
    eventPath,
    recorderPath,
    settingsPath,
  };
}

function installEventHook(hooks, eventName, handler) {
  const groups = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
  const filtered = removeManagedGroups(groups);
  const group = { hooks: [handler] };

  if (supportsMatcher(eventName)) {
    group.matcher = "*";
  }

  hooks[eventName] = [...filtered, group];
}

function buildHookHandler(eventName, paths, platform) {
  if (platform === "win32") {
    return {
      type: "command",
      shell: "powershell",
      command: `& '${escapePowerShellSingleQuoted(paths.recorderPath)}' -Mode hook -HookType '${eventName}'`,
      async: true,
      timeout: 5,
    };
  }

  return {
    type: "command",
    command: "node",
    args: [paths.recorderPath, "hook", eventName],
    async: true,
    timeout: 5,
  };
}

function buildStatusLine(paths, platform) {
  if (platform === "win32") {
    return {
      type: "command",
      command: `powershell -NoProfile -ExecutionPolicy Bypass -File "${paths.recorderPath}" -Mode statusline`,
      refreshInterval: 5,
      padding: 0,
    };
  }

  return {
    type: "command",
    command: `node "${paths.recorderPath}" statusline`,
    refreshInterval: 5,
    padding: 0,
  };
}

function supportsMatcher(eventName) {
  return [
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "PermissionDenied",
    "SessionStart",
    "SessionEnd",
    "Notification",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "PostCompact",
    "StopFailure",
  ].includes(eventName);
}

function hasManagedHooks(settings) {
  return Object.values(settings.hooks || {}).some((groups) => {
    return Array.isArray(groups) && groups.some(groupHasManagedHook);
  });
}

function groupHasManagedHook(group) {
  return Array.isArray(group && group.hooks) && group.hooks.some(isManagedHook);
}

function isManagedHook(handler) {
  const haystack = [
    handler && handler.command,
    ...(Array.isArray(handler && handler.args) ? handler.args : []),
  ].filter(Boolean).join(" ");
  return haystack.includes(MANAGED_MARKER);
}

function removeManagedGroups(groups) {
  if (!Array.isArray(groups)) return [];

  return groups.map((group) => {
    if (!Array.isArray(group && group.hooks)) return group;

    return {
      ...group,
      hooks: group.hooks.filter((handler) => !isManagedHook(handler)),
    };
  }).filter((group) => {
    return Array.isArray(group && group.hooks) && group.hooks.length > 0;
  });
}

function isManagedStatusLine(statusLine) {
  if (!statusLine || typeof statusLine !== "object") return false;
  return String(statusLine.command || "").includes(MANAGED_MARKER);
}

function readSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return {};

  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    return {};
  }
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeRecorder(recorderPath, platform) {
  const content = platform === "win32" ? powershellRecorder() : nodeRecorder();
  fs.writeFileSync(recorderPath, content, "utf8");
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function powershellRecorder() {
  return String.raw`param(
  [string]$Mode = "hook",
  [string]$HookType = ""
)

$ErrorActionPreference = "SilentlyContinue"
$inputJson = [Console]::In.ReadToEnd()
$homeDir = [Environment]::GetFolderPath("UserProfile")
$eventPath = $env:FLEXBAR_AI_CLAUDE_EVENTS
if ([string]::IsNullOrWhiteSpace($eventPath)) {
  $eventPath = Join-Path $homeDir ".flexbar-ai-dashboard\claude-events.jsonl"
}
$eventDir = Split-Path -Parent $eventPath
New-Item -ItemType Directory -Force -Path $eventDir | Out-Null

$data = $null
if (-not [string]::IsNullOrWhiteSpace($inputJson)) {
  try { $data = $inputJson | ConvertFrom-Json -Depth 100 } catch { $data = $inputJson }
}

$record = [ordered]@{
  timestamp = (Get-Date).ToUniversalTime().ToString("o")
  source = if ($Mode -eq "statusline") { "statusline" } else { "hook" }
  type = if ($Mode -eq "statusline") { "statusline" } else { $HookType }
  hook_type = if ($Mode -eq "statusline") { $null } else { $HookType }
  data = $data
}
($record | ConvertTo-Json -Compress -Depth 100) | Add-Content -LiteralPath $eventPath -Encoding UTF8

if ($Mode -eq "statusline") {
  $model = $data.model.display_name
  if ([string]::IsNullOrWhiteSpace($model)) { $model = $data.model.id }
  if ([string]::IsNullOrWhiteSpace($model)) { $model = "Claude" }
  $cwd = $data.workspace.current_dir
  if ([string]::IsNullOrWhiteSpace($cwd)) { $cwd = $data.cwd }
  $dir = if ([string]::IsNullOrWhiteSpace($cwd)) { "" } else { Split-Path -Leaf $cwd }
  $ctx = $data.context_window.used_percentage
  $fiveHour = $data.rate_limits.five_hour.used_percentage
  $parts = @("[$model]")
  if (-not [string]::IsNullOrWhiteSpace($dir)) { $parts += $dir }
  if ($ctx -ne $null) { $parts += ("ctx {0:N0}%" -f [double]$ctx) }
  if ($fiveHour -ne $null) { $parts += ("5h {0:N0}%" -f [double]$fiveHour) }
  Write-Output ($parts -join " ")
}

exit 0
`;
}

function nodeRecorder() {
  return `#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const mode = process.argv[2] || "hook";
const hookType = process.argv[3] || "";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const eventPath = process.env.FLEXBAR_AI_CLAUDE_EVENTS ||
    path.join(os.homedir(), ".flexbar-ai-dashboard", "claude-events.jsonl");
  fs.mkdirSync(path.dirname(eventPath), { recursive: true });
  let data = null;
  try { data = input ? JSON.parse(input) : null; } catch { data = input; }
  const record = {
    timestamp: new Date().toISOString(),
    source: mode === "statusline" ? "statusline" : "hook",
    type: mode === "statusline" ? "statusline" : hookType,
    hook_type: mode === "statusline" ? null : hookType,
    data,
  };
  fs.appendFileSync(eventPath, JSON.stringify(record) + "\\n", "utf8");

  if (mode === "statusline") {
    const model = data?.model?.display_name || data?.model?.id || "Claude";
    const cwd = data?.workspace?.current_dir || data?.cwd || "";
    const dir = cwd ? path.basename(cwd) : "";
    const ctx = data?.context_window?.used_percentage;
    const fiveHour = data?.rate_limits?.five_hour?.used_percentage;
    const parts = [\`[\${model}]\`];
    if (dir) parts.push(dir);
    if (Number.isFinite(Number(ctx))) parts.push(\`ctx \${Math.round(Number(ctx))}%\`);
    if (Number.isFinite(Number(fiveHour))) parts.push(\`5h \${Math.round(Number(fiveHour))}%\`);
    process.stdout.write(parts.join(" ") + "\\n");
  }
});
`;
}

module.exports = {
  getClaudeBridgeStatus,
  installClaudeBridge,
  uninstallClaudeBridge,
  resolveBridgePaths,
};
