"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  chooseActiveCodexSession,
  collectCodexSnapshot,
  loadCodexOAuthCredentials,
  inferCodexActivity,
  normalizeCodexQuota,
  parseCodexEvent,
  readCodexSessionsFromFiles,
  summarizeCodexUsage,
} = require("../src/collectors/codex");
const {
  inferClaudeActivity,
  normalizeClaudeHookActivity,
  parseClaudeEntry,
  summarizeClaudeUsage,
} = require("../src/collectors/claude");

test("Codex parser extracts token_count usage", () => {
  const event = parseCodexEvent({
    timestamp: "2026-05-13T08:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 40,
          output_tokens: 12,
          reasoning_output_tokens: 3,
          total_tokens: 155,
        },
      },
    },
  });

  assert.equal(event.payloadType, "token_count");
  assert.deepEqual(event.usage, {
    inputTokens: 100,
    cachedInputTokens: 40,
    outputTokens: 12,
    reasoningOutputTokens: 3,
    totalTokens: 155,
  });
});

test("Codex parser marks total-only token_count usage as cumulative", () => {
  const event = parseCodexEvent({
    timestamp: "2026-05-13T08:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
        },
      },
    },
  });

  assert.equal(event.usage.cumulative, true);
});

test("Codex usage summary preserves cumulative token event metadata", () => {
  const summary = summarizeCodexUsage([
    {
      timestamp: "2026-05-13T08:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120,
          },
        },
      },
    },
  ]);

  assert.equal(summary.recentTokenEvents[0].cumulative, true);
});

test("Codex activity reports an open function call as tool activity", () => {
  const events = [
    {
      timestamp: "2026-05-13T08:00:00.000Z",
      type: "response_item",
      payload: { type: "reasoning" },
    },
    {
      timestamp: "2026-05-13T08:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell_command",
        arguments: "{\"command\":\"node --test test/*.test.js\",\"workdir\":\"C:\\\\repo\"}",
        call_id: "call-1",
      },
    },
  ];

  const activity = inferCodexActivity(events, Date.parse("2026-05-13T08:00:02.000Z"));

  assert.equal(activity.state, "tool");
  assert.equal(activity.detail, "shell_command");
  assert.match(activity.action, /node --test/);
});

test("Codex activity explains completed function_call_output using the preceding tool call", () => {
  const events = [
    {
      timestamp: "2026-05-13T08:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell_command",
        arguments: "{\"command\":\"rg collectCodex src\"}",
        call_id: "call-1",
      },
    },
    {
      timestamp: "2026-05-13T08:00:02.000Z",
      type: "response_item",
      payload: {
        type: "function_call_output",
        call_id: "call-1",
      },
    },
  ];

  const activity = inferCodexActivity(events, Date.parse("2026-05-13T08:00:03.000Z"));

  assert.equal(activity.state, "waiting");
  assert.equal(activity.detail, "shell_command");
  assert.equal(activity.action, "rg collectCodex src");
});

test("Codex apply_patch open action is summarized by edited file names", () => {
  const events = [
    {
      timestamp: "2026-05-13T08:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "apply_patch",
        arguments: {
          value: "*** Begin Patch\n*** Update File: test/prototypeMonitor.test.js\n@@\n-old\n+new\n*** Update File: src/prototype/monitorFormat.js\n@@\n-old\n+new\n*** End Patch",
        },
        call_id: "call-1",
      },
    }
  ];

  const activity = inferCodexActivity(events, Date.parse("2026-05-13T08:00:02.000Z"));

  assert.equal(activity.detail, "apply_patch");
  assert.equal(activity.action, "test/prototypeMonitor.test.js, src/prototype/monitorFormat.js");
});

test("Codex activity reports command approval requests separately", () => {
  const events = [
    {
      timestamp: "2026-05-13T08:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "approval_request",
        command: "npm install",
        reason: "requires user approval",
      },
    },
  ];

  const activity = inferCodexActivity(events, Date.parse("2026-05-13T08:00:02.000Z"));

  assert.equal(activity.state, "approval");
  assert.equal(activity.detail, "command");
  assert.equal(activity.action, "npm install");
});

test("Codex activity reports escalated shell commands awaiting output as approval", () => {
  const events = [
    {
      timestamp: "2026-05-13T08:00:01.000Z",
      type: "event_msg",
      payload: { type: "task_started" },
    },
    {
      timestamp: "2026-05-13T08:00:02.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell_command",
        arguments: JSON.stringify({
          command: "node src/prototype/print-snapshot.js --once",
          sandbox_permissions: "require_escalated",
          justification: "Allow prototype to read live Codex state?",
        }),
        call_id: "call-approval",
      },
    },
  ];

  const activity = inferCodexActivity(events, Date.parse("2026-05-13T08:05:02.000Z"));

  assert.equal(activity.state, "approval");
  assert.equal(activity.detail, "shell_command");
  assert.equal(activity.action, "node src/prototype/print-snapshot.js --once");
});

test("Codex activity clears unclosed approval calls at task completion", () => {
  const events = [
    {
      timestamp: "2026-05-13T08:00:00.000Z",
      type: "event_msg",
      payload: { type: "task_started" },
    },
    {
      timestamp: "2026-05-13T08:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell_command",
        arguments: JSON.stringify({
          command: "npm install",
          sandbox_permissions: "require_escalated",
        }),
        call_id: "call-approval",
      },
    },
    {
      timestamp: "2026-05-13T08:00:02.000Z",
      type: "event_msg",
      payload: { type: "task_complete" },
    },
  ];

  const activity = inferCodexActivity(events, Date.parse("2026-05-13T08:00:03.000Z"));

  assert.equal(activity.state, "idle");
  assert.equal(activity.detail, "task_complete");
});

test("Codex activity ignores approval calls from earlier turns", () => {
  const events = [
    {
      timestamp: "2026-05-13T08:00:00.000Z",
      type: "event_msg",
      payload: { type: "task_started" },
    },
    {
      timestamp: "2026-05-13T08:00:01.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "shell_command",
        arguments: JSON.stringify({
          command: "npm install",
          sandbox_permissions: "require_escalated",
        }),
        call_id: "old-call",
      },
    },
    {
      timestamp: "2026-05-13T08:00:02.000Z",
      type: "event_msg",
      payload: { type: "turn_aborted" },
    },
    {
      timestamp: "2026-05-13T08:01:00.000Z",
      type: "event_msg",
      payload: { type: "task_started" },
    },
    {
      timestamp: "2026-05-13T08:01:01.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
      },
    },
  ];

  const activity = inferCodexActivity(events, Date.parse("2026-05-13T08:01:02.000Z"));

  assert.equal(activity.state, "planning");
  assert.equal(activity.action, "planning...");
});

test("Codex activity explains custom_tool_call_output using custom tool input", () => {
  const events = [
    {
      timestamp: "2026-05-13T08:00:01.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "Read",
        input: { file_path: "src/plugin.js" },
        call_id: "call-2",
      },
    },
    {
      timestamp: "2026-05-13T08:00:02.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "call-2",
      },
    },
  ];

  const activity = inferCodexActivity(events, Date.parse("2026-05-13T08:00:03.000Z"));

  assert.equal(activity.state, "waiting");
  assert.equal(activity.detail, "Read");
  assert.equal(activity.action, "src/plugin.js");
});

test("Codex activity treats token_count as planning", () => {
  const events = [
    {
      timestamp: "2026-05-13T08:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
      },
    },
  ];

  const activity = inferCodexActivity(events, Date.parse("2026-05-13T08:00:02.000Z"));

  assert.equal(activity.state, "planning");
  assert.equal(activity.detail, "planning");
  assert.equal(activity.action, "planning...");
});

test("Codex usage summary returns latest observed token event", () => {
  const summary = summarizeCodexUsage([
    {
      timestamp: "2026-05-13T08:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
      },
    },
    {
      timestamp: "2026-05-13T08:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { last_token_usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28 } },
      },
    },
  ]);

  assert.equal(summary.observedTokenEvents, 2);
  assert.equal(summary.latestTurn.totalTokens, 28);
  assert.deepEqual(summary.recentTokenEvents.map((event) => event.totalTokens), [15, 28]);
  assert.deepEqual(summary.recentTokenEvents.map((event) => event.timestamp), [
    "2026-05-13T08:00:00.000Z",
    "2026-05-13T08:00:01.000Z",
  ]);
});

test("Codex usage summary limits recent token events to the latest ten", () => {
  const events = Array.from({ length: 12 }, (_, index) => ({
    timestamp: `2026-05-13T08:${String(index).padStart(2, "0")}:00.000Z`,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: index,
          output_tokens: index + 1,
          total_tokens: 100 + index,
        },
      },
    },
  }));

  const summary = summarizeCodexUsage(events);

  assert.deepEqual(summary.recentTokenEvents.map((event) => event.totalTokens), [102, 103, 104, 105, 106, 107, 108, 109, 110, 111]);
});

test("Codex active session is selected by latest active rollout file, not first session row", () => {
  const sessions = [
    { id: "old-session", title: "Old", updatedAt: "2026-05-13T08:00:00.000Z" },
    { id: "new-session", title: "New", updatedAt: "2026-05-13T08:05:00.000Z" },
  ];
  const chosen = chooseActiveCodexSession(sessions, {
    sessionId: "new-session",
    activity: { state: "tool", detail: "shell_command" },
    usage: { latestTurn: { totalTokens: 99 } },
  });

  assert.equal(chosen.id, "new-session");
  assert.equal(chosen.activity.state, "tool");
  assert.equal(chosen.usage.latestTurn.totalTokens, 99);
});

test("Codex active session ignores internal latest rollout files", () => {
  const sessions = [
    { id: "internal-session", title: "Approval assessor", internal: true, updatedAt: "2026-05-13T08:06:00.000Z", activity: { state: "approval" } },
    { id: "real-session", title: "Real work", updatedAt: "2026-05-13T08:05:00.000Z", activity: { state: "thinking" } },
  ];

  const chosen = chooseActiveCodexSession(sessions, {
    sessionId: "internal-session",
    activity: { state: "approval", detail: "shell_command" },
  });

  assert.equal(chosen.id, "real-session");
  assert.equal(chosen.activity.state, "thinking");
});

test("Codex active session keeps indexed title and exposes latest title", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-active-title-"));
  const codexHome = path.join(tempDir, ".codex");
  const sessionDir = path.join(codexHome, "sessions", "2026", "05", "13");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({
      id: "active-session",
      thread_name: "Fix ws localhost undefined",
      updated_at: "2026-05-13T08:00:00Z",
    }),
  ].join("\n"), "utf8");

  const filePath = path.join(sessionDir, "rollout-2026-05-13T09-00-00-active-session.jsonl");
  fs.writeFileSync(filePath, [
    JSON.stringify({
      timestamp: "2026-05-13T09:00:00.000Z",
      type: "session_meta",
      payload: { id: "active-session", cwd: "C:\\repo" },
    }),
    JSON.stringify({
      timestamp: "2026-05-13T09:00:01.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "Fix ws localhost undefined" },
    }),
    JSON.stringify({
      timestamp: "2026-05-13T09:05:00.000Z",
      type: "event_msg",
      payload: { type: "task_started" },
    }),
    JSON.stringify({
      timestamp: "2026-05-13T09:05:01.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "为什么一直固定显示旧 session？" },
    }),
  ].join("\n"), "utf8");

  const snapshot = await collectCodexSnapshot({
    codexHome,
    includeQuota: false,
    includeUsage: false,
    skipAppServer: true,
    skipOAuthQuota: true,
  });

  assert.equal(snapshot.activeSession.title, "Fix ws localhost undefined");
  assert.equal(snapshot.activeSession.latestTitle, snapshot.sessions[0].latestTitle);
  assert.equal(snapshot.sessions[0].title, "Fix ws localhost undefined");
  assert.ok(snapshot.sessions[0].latestTitle);
});

test("Codex fallback session updatedAt uses last activity time before session index time", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-last-activity-"));
  const codexHome = path.join(tempDir, ".codex");
  const sessionDir = path.join(codexHome, "sessions", "2026", "05", "13");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({
      id: "created-newer",
      thread_name: "Created Newer",
      updated_at: "2026-05-13T09:00:00Z",
    }),
    JSON.stringify({
      id: "last-active",
      thread_name: "Last Active",
      updated_at: "2026-05-13T08:00:00Z",
    }),
  ].join("\n"), "utf8");

  const createdNewerPath = path.join(sessionDir, "rollout-2026-05-13T09-00-00-created-newer.jsonl");
  fs.writeFileSync(createdNewerPath, [
    JSON.stringify({
      timestamp: "2026-05-13T09:01:00.000Z",
      type: "event_msg",
      payload: { type: "task_complete" },
    }),
  ].join("\n"), "utf8");

  const lastActivePath = path.join(sessionDir, "rollout-2026-05-13T08-00-00-last-active.jsonl");
  fs.writeFileSync(lastActivePath, [
    JSON.stringify({
      timestamp: "2026-05-13T09:05:00.000Z",
      type: "event_msg",
      payload: { type: "task_complete" },
    }),
  ].join("\n"), "utf8");

  const sessions = readCodexSessionsFromFiles([createdNewerPath, lastActivePath], codexHome, { includeUsage: false });

  assert.equal(sessions.find((session) => session.id === "last-active").updatedAt, "2026-05-13T09:05:00.000Z");
  assert.equal(sessions.find((session) => session.id === "created-newer").updatedAt, "2026-05-13T09:01:00.000Z");
});

test("Codex fallback sessions are limited to rollout files and deduplicated", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-sessions-"));
  const codexHome = path.join(tempDir, ".codex");
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({ id: "active-a", thread_name: "Active A", updated_at: "2026-05-13T08:00:00Z" }),
    JSON.stringify({ id: "active-b", thread_name: "Active B", updated_at: "2026-05-13T09:00:00Z" }),
    JSON.stringify({ id: "archived-c", thread_name: "Archived C", updated_at: "2026-05-12T09:00:00Z" }),
  ].join("\n"), "utf8");

  const files = [
    path.join(codexHome, "sessions", "2026", "05", "13", "rollout-2026-05-13T08-00-00-active-a.jsonl"),
    path.join(codexHome, "sessions", "2026", "05", "13", "rollout-2026-05-13T09-00-00-active-b.jsonl"),
    path.join(codexHome, "sessions", "2026", "05", "13", "rollout-2026-05-13T09-01-00-active-b.jsonl"),
  ];

  const sessions = readCodexSessionsFromFiles(files, codexHome);

  assert.deepEqual(sessions.map((session) => session.title), ["Active A", "Active B"]);
});

test("Codex fallback session title inherits title from forked parent", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-fork-title-"));
  const codexHome = path.join(tempDir, ".codex");
  const sessionDir = path.join(codexHome, "sessions", "2026", "05", "13");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(codexHome, "session_index.jsonl"), [
    JSON.stringify({ id: "parent-session", thread_name: "开发 Codex Claude 用量插件", updated_at: "2026-05-13T08:00:00Z" }),
  ].join("\n"), "utf8");

  const filePath = path.join(sessionDir, "rollout-2026-05-13T09-00-00-child-session.jsonl");
  fs.writeFileSync(filePath, [
    JSON.stringify({
      timestamp: "2026-05-13T09:00:00.000Z",
      type: "session_meta",
      payload: { id: "child-session", forked_from_id: "parent-session", cwd: "C:\\repo" },
    }),
    JSON.stringify({
      timestamp: "2026-05-13T09:00:01.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "latest debug turn" },
    }),
  ].join("\n"), "utf8");

  const sessions = readCodexSessionsFromFiles([filePath], codexHome, { includeUsage: false });

  assert.equal(sessions[0].title, "开发 Codex Claude 用量插件");
  assert.equal(sessions[0].cwd, "C:\\repo");
});

test("Codex fallback session title derives from first meaningful user message", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-user-title-"));
  const codexHome = path.join(tempDir, ".codex");
  const sessionDir = path.join(codexHome, "sessions", "2026", "05", "13");
  fs.mkdirSync(sessionDir, { recursive: true });

  const filePath = path.join(sessionDir, "rollout-2026-05-13T09-00-00-new-session.jsonl");
  fs.writeFileSync(filePath, [
    JSON.stringify({
      timestamp: "2026-05-13T09:00:00.000Z",
      type: "session_meta",
      payload: { id: "new-session", cwd: "C:\\repo" },
    }),
    JSON.stringify({
      timestamp: "2026-05-13T09:00:01.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "The user selected the lines 1 to 2 from c:\\repo\\a.js" },
    }),
    JSON.stringify({
      timestamp: "2026-05-13T09:00:02.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "修复等待批准状态错乱" },
    }),
  ].join("\n"), "utf8");

  const sessions = readCodexSessionsFromFiles([filePath], codexHome, { includeUsage: false });

  assert.equal(sessions[0].title, "修复等待批准状态错乱");
});

test("Codex approval assessment sessions are marked internal", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-internal-session-"));
  const codexHome = path.join(tempDir, ".codex");
  const sessionDir = path.join(codexHome, "sessions", "2026", "05", "13");
  fs.mkdirSync(sessionDir, { recursive: true });

  const filePath = path.join(sessionDir, "rollout-2026-05-13T09-00-00-approval-assessor.jsonl");
  fs.writeFileSync(filePath, [
    JSON.stringify({
      timestamp: "2026-05-13T09:00:00.000Z",
      type: "session_meta",
      payload: { id: "approval-assessor", cwd: "C:\\repo" },
    }),
    JSON.stringify({
      timestamp: "2026-05-13T09:00:01.000Z",
      type: "event_msg",
      payload: {
        type: "user_message",
        message: "The following is the Codex agent history added since your last approval assessment.",
      },
    }),
  ].join("\n"), "utf8");

  const sessions = readCodexSessionsFromFiles([filePath], codexHome, { includeUsage: false });

  assert.equal(sessions[0].internal, true);
});

test("Codex quota parser extracts nested usage percentages", () => {
  const quota = normalizeCodexQuota({
    rateLimitsByLimitId: {
      five_hour: {
        primary_window: { used_percent: 73, reset_at: "2026-05-13T10:00:00Z" },
      },
      weekly: {
        label: "weekly",
        utilization: 41,
        resets_at: "2026-05-20T10:00:00Z",
      },
    },
  });

  assert.deepEqual(quota.limits.map((limit) => ({
    label: limit.label,
    usedPercent: limit.usedPercent,
    resetAt: limit.resetAt,
  })), [
    { label: "primary", usedPercent: 73, resetAt: "2026-05-13T10:00:00Z" },
    { label: "weekly", usedPercent: 41, resetAt: "2026-05-20T10:00:00Z" },
  ]);
});

test("Codex quota parser extracts deeply nested primary and secondary windows", () => {
  const quota = normalizeCodexQuota({
    rateLimitsByLimitId: {
      account: {
        windows: {
          five_hour: {
            used_percent: 12,
            reset_at: "2026-05-13T15:00:00Z",
          },
          weekly: {
            usedPercent: 34,
            resetAt: "2026-05-20T15:00:00Z",
          },
        },
      },
    },
  });

  assert.deepEqual(quota.limits.map((limit) => ({
    label: limit.label,
    usedPercent: limit.usedPercent,
    resetAt: limit.resetAt,
  })), [
    { label: "account.five_hour", usedPercent: 12, resetAt: "2026-05-13T15:00:00Z" },
    { label: "account.weekly", usedPercent: 34, resetAt: "2026-05-20T15:00:00Z" },
  ]);
});

test("Codex quota parser labels rate limit windows by primary and secondary windows", () => {
  const quota = normalizeCodexQuota({
    rate_limit: {
      primary_window: {
        used_percent: 7,
        reset_at: 1778696068,
      },
      secondary_window: {
        used_percent: 6,
        reset_at: 1779189630,
      },
    },
    additional_rate_limits: [
      {
        rate_limit: {
          primary_window: {
            used_percent: 0,
            reset_at: 1778698560,
          },
          secondary_window: {
            used_percent: 0,
            reset_at: 1779285360,
          },
        },
      },
    ],
  });

  assert.deepEqual(quota.limits.map((limit) => ({
    label: limit.label,
    usedPercent: limit.usedPercent,
    resetAt: limit.resetAt,
  })), [
    { label: "primary", usedPercent: 7, resetAt: 1778696068 },
    { label: "secondary", usedPercent: 6, resetAt: 1779189630 },
    { label: "primary", usedPercent: 0, resetAt: 1778698560 },
    { label: "secondary", usedPercent: 0, resetAt: 1779285360 },
  ]);
});

test("Codex OAuth credentials load from auth.json without exposing token", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-auth-"));
  const authPath = path.join(tempDir, "auth.json");
  fs.writeFileSync(authPath, JSON.stringify({
    tokens: {
      access_token: "secret-access-token",
      account_id: "account-1",
    },
  }), "utf8");

  const credentials = loadCodexOAuthCredentials(tempDir);

  assert.equal(credentials.available, true);
  assert.equal(credentials.accountId, "account-1");
  assert.equal(credentials.accessToken, "secret-access-token");
});

test("Claude parser extracts usage and tool use from assistant entries", () => {
  const entry = parseClaudeEntry({
    timestamp: "2026-05-13T08:00:00.000Z",
    type: "assistant",
    sessionId: "session-1",
    cwd: "C:\\repo",
    requestId: "req-1",
    message: {
      id: "msg-1",
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 7,
        cache_read_input_tokens: 11,
      },
      content: [{ type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "C:\\repo\\src\\plugin.js" } }],
    },
  });

  assert.equal(entry.sessionId, "session-1");
  assert.equal(entry.model, "claude-sonnet-4-6");
  assert.deepEqual(entry.toolUses, [{ id: "tool-1", name: "Read", input: { file_path: "C:\\repo\\src\\plugin.js" } }]);
  assert.equal(entry.usage.cacheReadInputTokens, 11);
});

test("Claude sessions derive title from first user text when session_name is absent", () => {
  const { summarizeClaudeSessions } = require("../src/collectors/claude");
  const sessions = summarizeClaudeSessions([
    {
      filePath: "C:\\Users\\tongy\\.claude\\projects\\c--Users-tongy-Develop-FlexDesigner2\\session.jsonl",
      entry: {
        timestamp: "2026-05-13T08:00:00.000Z",
        type: "user",
        sessionId: "session-1",
        cwd: "C:\\repo",
        message: {
          content: [{ type: "text", text: "请帮我实现 Flexbar 插件的实时状态监控和用量展示" }],
        },
      },
    },
    {
      filePath: "C:\\Users\\tongy\\.claude\\projects\\c--Users-tongy-Develop-FlexDesigner2\\session.jsonl",
      entry: {
        timestamp: "2026-05-13T08:00:01.000Z",
        type: "assistant",
        sessionId: "session-1",
        message: { id: "msg-1", content: [{ type: "text", text: "ok" }] },
      },
    },
  ]);

  assert.equal(sessions[0].title, "请帮我实现 Flexbar 插件的实时状态监控和用量展示");
});

test("Claude session title skips IDE context messages before user request", () => {
  const { summarizeClaudeSessions } = require("../src/collectors/claude");
  const sessions = summarizeClaudeSessions([
    {
      filePath: "C:\\Users\\tongy\\.claude\\projects\\project\\session.jsonl",
      entry: {
        timestamp: "2026-05-13T08:00:00.000Z",
        type: "user",
        sessionId: "session-1",
        message: { content: [{ type: "text", text: "The user selected the lines 10 to 12 from c:\\repo\\src\\plugin.js" }] },
      },
    },
    {
      filePath: "C:\\Users\\tongy\\.claude\\projects\\project\\session.jsonl",
      entry: {
        timestamp: "2026-05-13T08:00:01.000Z",
        type: "user",
        sessionId: "session-1",
        message: { content: [{ type: "text", text: "详情页里的 readme 显示区滚动条不要卡死" }] },
      },
    },
  ]);

  assert.equal(sessions[0].title, "详情页里的 readme 显示区滚动条不要卡死");
});

test("Claude usage summary deduplicates repeated message/request pairs", () => {
  const raw = {
    timestamp: "2026-05-13T08:00:00.000Z",
    type: "assistant",
    sessionId: "session-1",
    requestId: "req-1",
    message: {
      id: "msg-1",
      usage: { input_tokens: 100, output_tokens: 20 },
      content: [{ type: "text", text: "ok" }],
    },
  };

  const summary = summarizeClaudeUsage([
    { filePath: "a.jsonl", entry: raw },
    { filePath: "a.jsonl", entry: raw },
  ]);

  assert.equal(summary.observedTokenEvents, 1);
  assert.equal(summary.totals.inputTokens, 100);
  assert.equal(summary.totals.outputTokens, 20);
  assert.deepEqual(summary.recentTokenEvents.map((event) => event.totalTokens), [120]);
});

test("Claude usage summary exposes recent token events in chronological order", () => {
  const summary = summarizeClaudeUsage([
    {
      filePath: "a.jsonl",
      entry: {
        timestamp: "2026-05-13T08:00:00.000Z",
        type: "assistant",
        sessionId: "session-1",
        requestId: "req-1",
        message: {
          id: "msg-1",
          usage: { input_tokens: 100, output_tokens: 20 },
        },
      },
    },
    {
      filePath: "a.jsonl",
      entry: {
        timestamp: "2026-05-13T08:01:00.000Z",
        type: "assistant",
        sessionId: "session-1",
        requestId: "req-2",
        message: {
          id: "msg-2",
          usage: {
            input_tokens: 60,
            output_tokens: 30,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5,
          },
        },
      },
    },
  ]);

  assert.deepEqual(summary.recentTokenEvents.map((event) => event.totalTokens), [120, 105]);
  assert.deepEqual(summary.recentTokenEvents.map((event) => event.timestamp), [
    "2026-05-13T08:00:00.000Z",
    "2026-05-13T08:01:00.000Z",
  ]);
});

test("Claude activity prefers high-confidence bridge hook events", () => {
  const bridge = {
    activity: {
      state: "tool",
      detail: "Bash",
      confidence: "high",
      source: "claude_hooks",
      lastEventAt: "2026-05-13T08:00:00.000Z",
    },
  };

  const activity = inferClaudeActivity([], bridge, Date.parse("2026-05-13T08:00:01.000Z"));

  assert.equal(activity.state, "tool");
  assert.equal(activity.detail, "Bash");
  assert.equal(activity.confidence, "high");
});

test("Claude notification hooks report permission prompts as approval requests", () => {
  const activity = normalizeClaudeHookActivity({
    hook_type: "Notification",
    timestamp: "2026-05-13T08:00:00.000Z",
    data: {
      message: "Claude needs your permission to use Bash: npm install",
      tool_name: "Bash",
      tool_input: { command: "npm install" },
    },
  });

  assert.equal(activity.state, "approval");
  assert.equal(activity.detail, "Bash");
  assert.equal(activity.action, "npm install");
  assert.equal(activity.confidence, "high");
});
