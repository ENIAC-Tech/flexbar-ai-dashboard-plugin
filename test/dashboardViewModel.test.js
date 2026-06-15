"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDashboardState,
  buildDashboardViewModel,
  formatActivityText,
} = require("../src/dashboard/viewModel");

test("dashboard assigns session keys to the most recently active non-archived sessions", () => {
  const state = createDashboardState();
  const snapshot = {
    providers: {
      codex: {
        sessions: [
          session("codex-old", "Old Codex", "2026-05-13T08:00:00.000Z", "idle", 10),
          session("codex-active", "Active Codex", "2026-05-13T08:05:00.000Z", "tool", 20),
          session("codex-archived", "Archived", "2026-05-13T08:06:00.000Z", "tool", 30, true),
        ],
      },
      claude: {
        sessions: [
          session("claude-new", "New Claude", "2026-05-13T08:07:00.000Z", "thinking", 40),
        ],
      },
    },
  };

  const model = buildDashboardViewModel(snapshot, state, { language: "zh", sessionSlots: 2 });

  assert.deepEqual(model.sessions.map((item) => item.id), ["claude-new", "codex-active"]);
  assert.equal(model.sessions[0].title, "New Claude");
  assert.equal(model.sessions[1].activity, "\u6b63\u5728\u8fd0\u884c\u547d\u4ee4: rg src");
  assert.equal(model.totalTokens.label, "70");
});

test("dashboard always shows active sessions before newer completed sessions", () => {
  const state = createDashboardState();
  const snapshot = {
    providers: {
      codex: {
        sessions: [
          session("codex-active", "Active Codex", "2026-05-13T08:00:00.000Z", "tool", 20),
          session("codex-done", "Newer Done", "2026-05-13T08:10:00.000Z", "idle", 30),
        ],
      },
      claude: {
        sessions: [
          session("claude-thinking", "Claude Thinking", "2026-05-13T07:50:00.000Z", "thinking", 40),
        ],
      },
    },
  };

  const model = buildDashboardViewModel(snapshot, state, { sessionSlots: 2 });

  assert.deepEqual(model.sessions.map((item) => item.id), ["codex-active", "claude-thinking"]);
});

test("dashboard keeps newest order within active sessions", () => {
  const state = createDashboardState();
  const snapshot = {
    providers: {
      codex: {
        sessions: [
          session("active-old", "Active Old", "2026-05-13T08:00:00.000Z", "tool", 20),
          session("active-new", "Active New", "2026-05-13T08:10:00.000Z", "thinking", 30),
        ],
      },
      claude: { sessions: [] },
    },
  };

  const model = buildDashboardViewModel(snapshot, state, { sessionSlots: 2 });

  assert.deepEqual(model.sessions.map((item) => item.id), ["active-new", "active-old"]);
});

test("dashboard orders sessions by last activity time before indexed update time", () => {
  const state = createDashboardState();
  const snapshot = {
    providers: {
      codex: {
        sessions: [
          {
            ...session("created-newer", "Created Newer", "2026-05-13T09:00:00.000Z", "tool", 20),
            activity: {
              state: "tool",
              detail: "shell_command",
              action: "rg src",
              lastEventAt: "2026-05-13T09:01:00.000Z",
            },
          },
          {
            ...session("last-active", "Last Active", "2026-05-13T08:00:00.000Z", "tool", 30),
            activity: {
              state: "tool",
              detail: "shell_command",
              action: "node --test",
              lastEventAt: "2026-05-13T09:05:00.000Z",
            },
          },
        ],
      },
      claude: { sessions: [] },
    },
  };

  const model = buildDashboardViewModel(snapshot, state, { sessionSlots: 2 });

  assert.deepEqual(model.sessions.map((item) => item.id), ["last-active", "created-newer"]);
});

test("dashboard marks approval sessions orange and finished-unread sessions green until viewed", () => {
  const state = createDashboardState();
  const activeSnapshot = {
    providers: {
      codex: {
        sessions: [
          {
            id: "s1",
            title: "Approval task",
            updatedAt: "2026-05-13T08:00:00.000Z",
            activity: { state: "approval", detail: "shell_command", action: "npm install" },
          },
        ],
      },
      claude: { sessions: [] },
    },
  };

  let model = buildDashboardViewModel(activeSnapshot, state, { language: "zh", sessionSlots: 1 });
  assert.equal(model.sessions[0].status, "approval");
  assert.equal(model.sessions[0].statusColor, "orange");
  assert.equal(model.sessions[0].activity, "\u7b49\u5f85\u6279\u51c6: npm install");

  const doneSnapshot = {
    providers: {
      codex: {
        sessions: [
          {
            id: "s1",
            title: "Approval task",
            updatedAt: "2026-05-13T08:01:00.000Z",
            activity: { state: "idle", detail: "task_complete" },
          },
        ],
      },
      claude: { sessions: [] },
    },
  };

  model = buildDashboardViewModel(doneSnapshot, state, { language: "zh", sessionSlots: 1 });
  assert.equal(model.sessions[0].status, "finished-unread");
  assert.equal(model.sessions[0].statusColor, "green");

  state.markViewed("codex:s1");
  model = buildDashboardViewModel(doneSnapshot, state, { language: "zh", sessionSlots: 1 });
  assert.equal(model.sessions[0].status, "idle");
  assert.equal(model.sessions[0].statusColor, "gray");
});

test("dashboard plan usage exposes remaining percentages for 5h and weekly windows", () => {
  const model = buildDashboardViewModel({
    providers: {
      codex: {
        sessions: [],
        quota: {
          limits: [
            { label: "primary", usedPercent: 8, resetAt: 1778696068 },
            { label: "secondary", usedPercent: 35, resetAt: 1779189630 },
          ],
        },
      },
      claude: {
        sessions: [],
        quota: {
          rateLimits: {
            five_hour: { used_percentage: 60, resets_at: "2026-05-13T12:00:00Z" },
          },
        },
      },
    },
  }, createDashboardState(), { sessionSlots: 0 });

  assert.deepEqual(model.planUsage.items.map((item) => ({
    provider: item.provider,
    label: item.label,
    usedPercent: item.usedPercent,
    remainingPercent: item.remainingPercent,
  })), [
    { provider: "Codex", label: "5h", usedPercent: 8, remainingPercent: 92 },
    { provider: "Codex", label: "Weekly", usedPercent: 35, remainingPercent: 65 },
    { provider: "Claude", label: "5h", usedPercent: 60, remainingPercent: 40 },
  ]);
});

test("dashboard reset timer exposes reset timestamps and window lengths for 5h and weekly", () => {
  const model = buildDashboardViewModel({
    providers: {
      codex: {
        sessions: [],
        quota: {
          limits: [
            { label: "primary", usedPercent: 8, resetAt: 1778696068 },
            { label: "secondary", usedPercent: 35, resetAt: 1779189630 },
          ],
        },
      },
      claude: {
        sessions: [],
        quota: {
          rateLimits: {
            five_hour: { used_percentage: 60, resets_at: "2026-05-13T12:00:00Z" },
          },
        },
      },
    },
  }, createDashboardState(), { sessionSlots: 0 });

  assert.deepEqual(model.resetTimer.items, [
    { provider: "Codex", label: "5h", resetAtMs: 1778696068000, windowSeconds: 18000 },
    { provider: "Codex", label: "Weekly", resetAtMs: 1779189630000, windowSeconds: 604800 },
    { provider: "Claude", label: "5h", resetAtMs: Date.parse("2026-05-13T12:00:00Z"), windowSeconds: 18000 },
  ]);
});

test("dashboard localizes labels and activity text from the requested language", () => {
  const model = buildDashboardViewModel({
    providers: {
      codex: {
        sessions: [
          session("s1", "", "2026-05-13T08:00:00.000Z", "tool", 20),
        ],
      },
      claude: { sessions: [] },
    },
  }, createDashboardState(), { language: "en", sessionSlots: 1 });

  assert.equal(model.sessions[0].activity, "Running command: rg src");
  assert.equal(model.totalTokens.title, "Token Usage");
  assert.equal(model.totalTokens.label, "20");
  assert.equal(model.planUsage.title, "Plan Usage");
  assert.equal(formatActivityText({ state: "waiting", detail: "Edit", action: "src/plugin.js" }, { language: "en" }), "Just edited: src/plugin.js");

  const zhModel = buildDashboardViewModel({
    providers: {
      codex: {
        sessions: [
          session("s1", "", "2026-05-13T08:00:00.000Z", "tool", 20),
        ],
      },
      claude: { sessions: [] },
    },
  }, createDashboardState(), { language: "zh-CN", sessionSlots: 1 });

  assert.equal(zhModel.sessions[0].activity, "\u6b63\u5728\u8fd0\u884c\u547d\u4ee4: rg src");
  assert.equal(zhModel.totalTokens.title, "\u4ee4\u724c\u7528\u91cf");
  assert.equal(zhModel.planUsage.title, "\u5957\u9910\u7528\u91cf");
});

test("dashboard token usage view exposes recent chart bars from provider usage", () => {
  const model = buildDashboardViewModel({
    providers: {
      codex: {
        usage: {
          recentTokenEvents: [
            { timestamp: "2026-05-13T08:00:00.000Z", totalTokens: 100 },
            { timestamp: "2026-05-13T08:01:00.000Z", totalTokens: 500 },
            { timestamp: "2026-05-13T08:02:00.000Z", totalTokens: 250 },
          ],
        },
        sessions: [],
      },
      claude: {
        usage: {
          recentTokenEvents: [
            { timestamp: "2026-05-13T08:03:00.000Z", totalTokens: 700 },
          ],
        },
        sessions: [],
      },
    },
  }, createDashboardState(), { sessionSlots: 0 });

  assert.deepEqual(model.totalTokens.recent.map((item) => ({
    value: item.value,
    intensity: item.intensity,
  })), [
    { value: 100, intensity: 20 },
    { value: 500, intensity: 100 },
    { value: 250, intensity: 50 },
    { value: 700, intensity: 100 },
  ]);
  assert.equal(model.totalTokens.recentLabel, "Recent usage");
});

test("dashboard token usage chart converts cumulative events to per-event bars", () => {
  const model = buildDashboardViewModel({
    providers: {
      codex: {
        usage: {
          recentTokenEvents: [
            { timestamp: "2026-05-13T08:00:00.000Z", totalTokens: 100, cumulative: true },
            { timestamp: "2026-05-13T08:01:00.000Z", totalTokens: 350, cumulative: true },
            { timestamp: "2026-05-13T08:02:00.000Z", totalTokens: 500, cumulative: true },
          ],
        },
        sessions: [],
      },
    },
  }, createDashboardState(), { sessionSlots: 0 });

  assert.deepEqual(model.totalTokens.recent.map((item) => ({
    value: item.value,
    label: item.label,
    intensity: item.intensity,
  })), [
    { value: 100, label: "100", intensity: 40 },
    { value: 250, label: "250", intensity: 100 },
    { value: 150, label: "150", intensity: 60 },
  ]);
});

test("dashboard activity formatter differentiates planning, tools, MCP, and completed tool output", () => {
  assert.equal(formatActivityText({ state: "planning", detail: "token_count", action: "planning..." }), "planning...");
  assert.equal(formatActivityText({ state: "tool", detail: "mcp__node_repl__js", action: "inspect" }, { language: "zh" }), "\u6b63\u5728\u4f7f\u7528 MCP mcp__node_repl__js: inspect");
  assert.equal(formatActivityText({ state: "tool", detail: "custom_tool", action: "run" }, { language: "zh" }), "\u6b63\u5728\u4f7f\u7528\u5de5\u5177 custom_tool: run");
  assert.equal(formatActivityText({ state: "waiting", detail: "Edit", action: "src/plugin.js" }, { language: "zh" }), "\u521a\u5b8c\u6210\u7f16\u8f91: src/plugin.js");
});

function session(id, title, updatedAt, state, totalTokens, archived = false) {
  return {
    id,
    title,
    archived,
    updatedAt,
    activity: { state, detail: state === "tool" ? "shell_command" : state, action: state === "tool" ? "rg src" : undefined },
    usage: { latestTurn: { totalTokens } },
  };
}
