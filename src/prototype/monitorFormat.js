"use strict";

function formatMonitorSnapshot(snapshot) {
  const lines = [];
  lines.push("AI session monitor");
  lines.push(`Collected: ${snapshot.collectedAt}`);
  lines.push("");
  lines.push(formatProvider("Codex", snapshot.providers.codex));
  lines.push("");
  lines.push(formatProvider("Claude", snapshot.providers.claude));
  return lines.join("\n");
}

function formatProvider(label, provider) {
  const lines = [label];
  const sessions = Array.isArray(provider.sessions) ? provider.sessions : [];
  const activity = provider.activity || {};
  const activeId = provider.activeSession && provider.activeSession.id || sessions[0] && sessions[0].id || null;
  lines.push(`  总用量 ${formatProviderTokens(provider)} | 订阅用量 ${formatSubscriptionUsage(provider.quota)}`);

  if (sessions.length === 0) {
    lines.push("  - no sessions | 已完成 | 无动态");
    return lines.join("\n");
  }

  sessions.filter((session) => !session.archived && !session.internal).forEach((session) => {
    const isActive = activeId && session.id === activeId;
    const sessionActivity = session.activity || (isActive ? activity : null);
    const state = isActive ? statusFromActivity(sessionActivity || activity) : "已完成";
    const action = state === "运行中" || state === "等待中" || state === "\u7b49\u5f85\u6279\u51c6" ? actionFromActivity(sessionActivity || activity) : "已完成";
    lines.push(`  - ${titleFromSession(session)} | ${state} | ${action} | tokens ${formatSessionTokens(session)}`);
  });

  return lines.join("\n");
}

function statusFromActivity(activity) {
  if (activity && activity.detail === "task_complete") return "已完成";
  switch (activity.state) {
    case "tool":
    case "thinking":
    case "planning":
    case "working":
    case "active":
      return "运行中";
    case "waiting":
      return "运行中";
    case "approval":
      return "\u7b49\u5f85\u6279\u51c6";
    case "idle":
    case "unknown":
    default:
      return "已完成";
  }
}

function actionFromActivity(activity) {
  if (!activity || !activity.state) return "已完成";
  if (activity.detail === "task_complete") return "已完成";

  if (activity.state === "tool") {
    const tool = activity.detail || "tool";
    return formatToolAction(tool, activity.action);
  }

  if (activity.state === "thinking") return activity.action && activity.action !== "thinking" ? `正在思考: ${activity.action}` : "正在思考";
  if (activity.state === "planning") return activity.action || "planning...";
  if (activity.state === "working") return activity.detail ? `正在处理: ${activity.detail}` : "正在处理";
  if (activity.state === "active") return activity.detail ? `正在处理: ${activity.detail}` : "正在处理";
  if (activity.state === "waiting") {
    if (isKnownTool(activity.detail) && activity.action) {
      return formatCompletedToolAction(activity.detail, activity.action);
    }
    return activity.detail ? `等待中: ${activity.detail}` : "等待用户输入";
  }
  if (activity.state === "approval") {
    return activity.action ? `\u7b49\u5f85\u6279\u51c6: ${activity.action}` : "\u7b49\u5f85\u6279\u51c6";
  }
  if (activity.state === "idle") return "空闲";
  if (activity.detail === "no session events") return "无动态";
  return activity.detail || "已完成";
}

function formatToolAction(tool, action) {
  const detail = action ? `: ${action}` : "";
  if (isMcpTool(tool)) return `正在使用 MCP ${tool}${detail}`;

  switch (tool) {
    case "shell_command":
    case "Bash":
      return `正在运行命令${detail}`;
    case "Read":
      return `正在读取${detail}`;
    case "Edit":
    case "MultiEdit":
    case "Write":
      return `正在编辑${detail}`;
    case "Grep":
    case "Glob":
    case "web_search":
    case "web_search_call":
      return `正在搜索${detail}`;
    default:
      return `正在使用工具 ${tool}${detail}`;
  }
}

function formatCompletedToolAction(tool, action) {
  const detail = action ? `: ${action}` : "";
  if (isMcpTool(tool)) return `刚完成使用 MCP ${tool}${detail}`;

  switch (tool) {
    case "shell_command":
    case "Bash":
      return `刚完成运行命令${detail}`;
    case "Read":
      return `刚完成读取${detail}`;
    case "Edit":
    case "MultiEdit":
    case "Write":
      return `刚完成编辑${detail}`;
    case "Grep":
    case "Glob":
    case "web_search":
    case "web_search_call":
      return `刚完成搜索${detail}`;
    default:
      return `刚完成使用工具 ${tool}${detail}`;
  }
}

function isMcpTool(tool) {
  return typeof tool === "string" && /^mcp(?:_|-|$)/i.test(tool);
}

function isKnownTool(tool) {
  return Boolean(tool) && ![
    "function_call_output",
    "custom_tool_call_output",
    "mcp_tool_call_output",
    "token_count",
  ].includes(tool);
}

function titleFromSession(session) {
  return session.title || session.project || session.cwd || session.id || "untitled";
}

function formatSessionTokens(session) {
  const usage = session.usage || {};
  const latest = usage.latestTurn;
  if (latest) return formatNumber(latest.totalTokens || tokenTotal(latest));

  const totals = usage.totals;
  if (totals) return formatNumber(tokenTotal(totals));

  return "unknown";
}

function formatProviderTokens(provider) {
  const sessions = Array.isArray(provider.sessions) ? provider.sessions.filter((session) => !session.archived && !session.internal) : [];
  let total = 0;
  let hasUsage = false;

  for (const session of sessions) {
    const value = sessionTokenValue(session);
    if (value !== null) {
      total += value;
      hasUsage = true;
    }
  }

  if (hasUsage) return formatNumber(total);

  const providerUsage = provider.usage || {};
  if (providerUsage.totals) return formatNumber(tokenTotal(providerUsage.totals));
  if (providerUsage.latestTurn) return formatNumber(providerUsage.latestTurn.totalTokens || tokenTotal(providerUsage.latestTurn));
  return "unknown";
}

function sessionTokenValue(session) {
  const usage = session && session.usage || {};
  if (usage.latestTurn) return usage.latestTurn.totalTokens || tokenTotal(usage.latestTurn);
  if (usage.totals) return tokenTotal(usage.totals);
  return null;
}

function formatSubscriptionUsage(quota) {
  const limits = dedupeQuotaLimits(extractQuotaLimits(quota));
  if (limits.length === 0) return "unavailable";

  return limits.map((limit) => {
    const label = humanQuotaLabel(limit.label || limit.id || "limit");
    const percent = Number.isFinite(Number(limit.usedPercent))
      ? `${Math.round(Number(limit.usedPercent))}%`
      : "?";
    return `${label} ${percent}${limit.resetAt ? ` reset ${formatResetAt(limit.resetAt)}` : ""}`;
  }).join("; ");
}

function dedupeQuotaLimits(limits) {
  const byLabel = new Map();

  for (const limit of limits) {
    const canonicalLabel = canonicalQuotaLabel(limit.label || limit.id || "");
    const label = canonicalLabel || limit.label;
    const existing = byLabel.get(label);
    if (!existing || Number(limit.usedPercent || 0) > Number(existing.usedPercent || 0)) {
      byLabel.set(label, { ...limit, label });
    }
  }

  return Array.from(byLabel.values());
}

function canonicalQuotaLabel(label) {
  const text = String(label || "");
  if (/(^|\.|_)primary$/i.test(text) || /five[_-]?hour/i.test(text)) return "primary";
  if (/(^|\.|_)secondary$/i.test(text) || /seven[_-]?day|week|weekly/i.test(text)) return "secondary";
  return text;
}

function humanQuotaLabel(label) {
  if (label === "primary") return "5小时";
  if (label === "secondary") return "每周";
  if (label === "five_hour") return "5小时";
  if (label === "seven_day") return "每周";
  return label;
}

function formatResetAt(value) {
  if (Number.isFinite(Number(value))) {
    const numeric = Number(value);
    const ms = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    return new Date(ms).toLocaleString();
  }
  return String(value);
}

function extractQuotaLimits(quota) {
  if (!quota) return [];
  if (Array.isArray(quota.limits)) {
    return quota.limits.map((limit) => ({
      label: limit.label || limit.id || limit.window,
      usedPercent: limit.usedPercent,
      resetAt: limit.resetAt,
    })).filter((limit) => limit.usedPercent !== undefined || limit.resetAt);
  }

  const rateLimits = quota.rateLimits || quota.rate_limits;
  if (rateLimits && typeof rateLimits === "object") {
    return Object.entries(rateLimits).map(([key, value]) => {
      if (!value || typeof value !== "object") return null;
      return {
        label: key,
        usedPercent: value.used_percentage ?? value.usedPercent ?? value.utilization,
        resetAt: value.resets_at ?? value.reset_at ?? value.resetAt,
      };
    }).filter(Boolean).filter((limit) => limit.usedPercent !== undefined || limit.resetAt);
  }

  return [];
}

function tokenTotal(usage) {
  return Object.values(usage || {}).reduce((sum, value) => {
    return sum + (Number.isFinite(Number(value)) ? Number(value) : 0);
  }, 0);
}

function formatNumber(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
  if (Math.abs(number) >= 1_000) return `${(number / 1_000).toFixed(1)}k`;
  return String(number);
}

module.exports = {
  formatMonitorSnapshot,
};
