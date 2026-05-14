"use strict";

const path = require("node:path");
const { summarizeToolAction } = require("./actionSummary");
const {
  latestFile,
  pathExists,
  readJsonlFiles,
  readJsonlTail,
  safeMtimeMs,
  walkJsonlFiles,
} = require("./jsonl");
const {
  resolveClaudeBridgePath,
  resolveClaudeProjectRoots,
} = require("./paths");

const CLAUDE_ACTIVITY_STALE_MS = 30_000;
const RECENT_TOKEN_EVENTS_LIMIT = 10;

function parseClaudeEntry(entry) {
  const message = entry && entry.message && typeof entry.message === "object"
    ? entry.message
    : {};
  const content = Array.isArray(message.content) ? message.content : [];
  const toolUses = content.filter((item) => item && item.type === "tool_use");
  const toolResults = content.filter((item) => item && item.type === "tool_result");

  return {
    timestamp: entry && entry.timestamp ? entry.timestamp : null,
    type: entry && entry.type ? entry.type : null,
    sessionId: entry && (entry.sessionId || entry.session_id) || null,
    cwd: entry && entry.cwd || null,
    messageId: entry && (entry.message_id || message.id) || null,
    requestId: entry && (entry.requestId || entry.request_id) || null,
    model: message.model || entry && entry.model || null,
    contentTypes: content.map((item) => item && item.type).filter(Boolean),
    toolUses: toolUses.map((item) => ({
      id: item.id || null,
      name: item.name || null,
      input: item.input || null,
    })),
    toolResults: toolResults.map((item) => ({
      toolUseId: item.tool_use_id || item.toolUseId || null,
      isError: Boolean(item.is_error || item.isError),
    })),
    usage: extractClaudeUsage(entry),
    userText: extractClaudeUserText(entry),
  };
}

function extractClaudeUserText(entry) {
  if (!entry || entry.type !== "user") return null;

  const messageContent = entry.message && entry.message.content;
  const directContent = entry.content;
  const content = Array.isArray(messageContent) ? messageContent : directContent;

  if (typeof content === "string") return titleOrNull(content);
  if (!Array.isArray(content)) return null;

  const text = content.map((item) => {
    if (!item) return "";
    if (typeof item === "string") return item;
    if (item.type === "text" && typeof item.text === "string") return item.text;
    return "";
  }).join(" ").trim();

  return titleOrNull(text);
}

function cleanTitle(text) {
  const cleaned = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned;
}

function titleOrNull(text) {
  const title = cleanTitle(text);
  if (!title || isIdeContextTitle(title)) return null;
  return title;
}

function isIdeContextTitle(title) {
  return [
    /^The user selected the lines?/i,
    /^The user opened the file/i,
    /^<ide_selection>/i,
    /^<command-name>/i,
  ].some((pattern) => pattern.test(title));
}

function extractClaudeUsage(entry) {
  const usage = entry && entry.message && entry.message.usage || entry && entry.usage;
  if (!usage) return null;

  return {
    inputTokens: numberFrom(usage.input_tokens),
    outputTokens: numberFrom(usage.output_tokens),
    cacheCreationInputTokens: numberFrom(usage.cache_creation_input_tokens ?? usage.cache_creation_tokens),
    cacheReadInputTokens: numberFrom(usage.cache_read_input_tokens ?? usage.cache_read_tokens),
  };
}

function summarizeClaudeUsage(fileEntries) {
  const seen = new Set();
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  let usageEvents = 0;
  let latestUsage = null;
  const recentTokenEvents = [];

  for (const { entry } of fileEntries) {
    const parsed = parseClaudeEntry(entry);
    if (!parsed.usage) continue;

    const key = parsed.messageId && parsed.requestId
      ? `${parsed.messageId}:${parsed.requestId}`
      : `${parsed.timestamp}:${parsed.sessionId}:${usageEvents}`;
    if (seen.has(key)) continue;
    seen.add(key);

    usageEvents += 1;
    latestUsage = parsed.usage;
    recentTokenEvents.push({
      timestamp: parsed.timestamp,
      ...parsed.usage,
      totalTokens: tokenTotal(parsed.usage),
    });
    totals.inputTokens += parsed.usage.inputTokens;
    totals.outputTokens += parsed.usage.outputTokens;
    totals.cacheCreationInputTokens += parsed.usage.cacheCreationInputTokens;
    totals.cacheReadInputTokens += parsed.usage.cacheReadInputTokens;
  }

  return {
    totals,
    latestTurn: latestUsage,
    observedTokenEvents: usageEvents,
    recentTokenEvents: recentTokenEvents.slice(-RECENT_TOKEN_EVENTS_LIMIT),
  };
}

function tokenTotal(usage) {
  return Object.values(usage || {}).reduce((sum, value) => {
    return sum + (Number.isFinite(Number(value)) ? Number(value) : 0);
  }, 0);
}

function summarizeClaudeUsageForSession(entries) {
  return summarizeClaudeUsage(entries.map((entry) => ({ filePath: "", entry })));
}

function inferClaudeActivity(events, bridgeSnapshot, now = Date.now()) {
  if (bridgeSnapshot && bridgeSnapshot.activity) {
    return bridgeSnapshot.activity;
  }

  const parsed = events.map(parseClaudeEntry).filter((event) => event.timestamp);
  const latest = parsed.at(-1) || null;
  if (!latest) {
    return {
      state: "unknown",
      detail: "no session events",
      confidence: "low",
      source: "claude_jsonl",
      lastEventAt: null,
      staleMs: null,
    };
  }

  const latestMs = Date.parse(latest.timestamp);
  const staleMs = Number.isFinite(latestMs) ? now - latestMs : null;
  if (staleMs !== null && staleMs > CLAUDE_ACTIVITY_STALE_MS) {
    return {
      state: "idle",
      detail: "no recent Claude event",
      confidence: "medium",
      source: "claude_jsonl",
      lastEventAt: latest.timestamp,
      staleMs,
    };
  }

  const openTool = findOpenClaudeTool(parsed);
  if (openTool) {
    return {
      state: "tool",
      detail: openTool.name || "tool_use",
      action: summarizeToolAction(openTool.name || "tool_use", openTool.input),
      confidence: "medium",
      source: "claude_jsonl",
      lastEventAt: latest.timestamp,
      staleMs,
    };
  }

  if (latest.type === "last-prompt") {
    return {
      state: "working",
      detail: "prompt submitted",
      confidence: "medium",
      source: "claude_jsonl",
      lastEventAt: latest.timestamp,
      staleMs,
    };
  }

  if (latest.toolResults.length > 0 || latest.type === "assistant") {
    return {
      state: "waiting",
      detail: latest.toolResults.length > 0 ? "tool_result" : "assistant_message",
      confidence: "low",
      source: "claude_jsonl",
      lastEventAt: latest.timestamp,
      staleMs,
    };
  }

  return {
    state: "active",
    detail: latest.type,
    confidence: "low",
    source: "claude_jsonl",
    lastEventAt: latest.timestamp,
    staleMs,
  };
}

function findOpenClaudeTool(parsedEvents) {
  const open = new Map();

  for (const event of parsedEvents) {
    for (const toolUse of event.toolUses) {
      open.set(toolUse.id || `index:${open.size}`, toolUse);
    }

    for (const toolResult of event.toolResults) {
      if (toolResult.toolUseId && open.has(toolResult.toolUseId)) {
        open.delete(toolResult.toolUseId);
      } else {
        const latestKey = Array.from(open.keys()).at(-1);
        if (latestKey) open.delete(latestKey);
      }
    }
  }

  return Array.from(open.values()).at(-1) || null;
}

function summarizeClaudeSessions(fileEntries) {
  const sessions = new Map();
  const entriesBySession = new Map();

  for (const { filePath, entry } of fileEntries) {
    const parsed = parseClaudeEntry(entry);
    if (!parsed.sessionId) continue;
    if (!entriesBySession.has(parsed.sessionId)) entriesBySession.set(parsed.sessionId, []);
    entriesBySession.get(parsed.sessionId).push(entry);

    const existing = sessions.get(parsed.sessionId) || {
      id: parsed.sessionId,
      title: null,
      cwd: parsed.cwd || null,
      project: projectNameFromFile(filePath),
      updatedAt: null,
      model: null,
      source: "claude_jsonl",
    };

    if (parsed.cwd) existing.cwd = parsed.cwd;
    if (parsed.model) existing.model = parsed.model;
    if (!existing.title && parsed.userText) existing.title = parsed.userText;
    if (!existing.updatedAt || compareTimestamp(parsed.timestamp, existing.updatedAt) > 0) {
      existing.updatedAt = parsed.timestamp;
    }

    sessions.set(parsed.sessionId, existing);
  }

  for (const [sessionId, session] of sessions) {
    const entries = entriesBySession.get(sessionId) || [];
    session.activity = inferClaudeActivity(entries, null);
    session.usage = summarizeClaudeUsageForSession(entries);
  }

  return Array.from(sessions.values()).sort((a, b) => compareTimestamp(b.updatedAt, a.updatedAt));
}

function readClaudeBridgeSnapshot(bridgePath) {
  if (!bridgePath || !pathExists(bridgePath)) return null;

  const events = readJsonlTail(bridgePath, 100);
  const latest = events.at(-1);
  if (!latest) return null;

  const status = [...events].reverse().find((event) => {
    return event.source === "statusline" || event.type === "statusline";
  }) || null;
  const hook = [...events].reverse().find((event) => {
    return event.hook_type || event.hookType || event.type && event.type !== "statusline";
  }) || null;

  return {
    source: "claude_bridge",
    bridgePath,
    latestEventAt: latest.timestamp || latest.receivedAt || null,
    status: status ? normalizeClaudeStatusLine(status) : null,
    activity: hook ? normalizeClaudeHookActivity(hook) : null,
  };
}

function normalizeClaudeStatusLine(event) {
  const data = event.data || event;
  return {
    sessionId: data.session_id || data.sessionId || null,
    sessionName: data.session_name || data.sessionName || null,
    cwd: data.cwd || data.workspace || null,
    model: data.model && (data.model.display_name || data.model.name) || data.model || null,
    agentName: data.agent && data.agent.name || data.agent_name || null,
    contextWindow: data.context_window || data.contextWindow || null,
    rateLimits: data.rate_limits || data.rateLimits || null,
    source: "claude_statusline",
  };
}

function normalizeClaudeHookActivity(event) {
  const hookType = event.hook_type || event.hookType || event.type;
  const data = event.data || event;
  const timestamp = event.timestamp || event.receivedAt || null;

  if (hookType === "PreToolUse") {
    return {
      state: "tool",
      detail: data.tool_name || data.toolName || data.name || "tool_use",
      action: summarizeToolAction(data.tool_name || data.toolName || data.name || "tool_use", data.tool_input || data.toolInput || data.input),
      confidence: "high",
      source: "claude_hooks",
      lastEventAt: timestamp,
      staleMs: timestamp ? Date.now() - Date.parse(timestamp) : null,
    };
  }

  if (hookType === "UserPromptSubmit" || hookType === "SessionStart") {
    return {
      state: "working",
      detail: hookType,
      confidence: "high",
      source: "claude_hooks",
      lastEventAt: timestamp,
      staleMs: timestamp ? Date.now() - Date.parse(timestamp) : null,
    };
  }

  if (hookType === "Notification") {
    if (looksLikeApprovalNotification(data)) {
      const toolName = data.tool_name || data.toolName || data.name || approvalToolFromMessage(data.message) || "approval";
      return {
        state: "approval",
        detail: toolName,
        action: summarizeToolAction(toolName, data.tool_input || data.toolInput || data.input) || approvalActionFromMessage(data.message),
        confidence: "high",
        source: "claude_hooks",
        lastEventAt: timestamp,
        staleMs: timestamp ? Date.now() - Date.parse(timestamp) : null,
      };
    }

    return {
      state: "waiting",
      detail: data.message || "notification",
      confidence: "high",
      source: "claude_hooks",
      lastEventAt: timestamp,
      staleMs: timestamp ? Date.now() - Date.parse(timestamp) : null,
    };
  }

  if (hookType === "Stop" || hookType === "PostToolUse") {
    return {
      state: "waiting",
      detail: hookType,
      confidence: "high",
      source: "claude_hooks",
      lastEventAt: timestamp,
      staleMs: timestamp ? Date.now() - Date.parse(timestamp) : null,
    };
  }

  if (hookType === "SessionEnd") {
    return {
      state: "idle",
      detail: "session ended",
      confidence: "high",
      source: "claude_hooks",
      lastEventAt: timestamp,
      staleMs: timestamp ? Date.now() - Date.parse(timestamp) : null,
    };
  }

  return {
    state: "active",
    detail: hookType || "hook",
    confidence: "medium",
    source: "claude_hooks",
    lastEventAt: timestamp,
    staleMs: timestamp ? Date.now() - Date.parse(timestamp) : null,
  };
}

function looksLikeApprovalNotification(data) {
  return isApprovalText(data && data.message)
    || isApprovalText(data && data.detail)
    || isApprovalText(data && data.reason);
}

function approvalToolFromMessage(message) {
  if (typeof message !== "string") return null;
  const match = message.match(/\b(?:use|run|execute)\s+([A-Za-z_][\w-]*)\s*:/i);
  return match ? match[1] : null;
}

function approvalActionFromMessage(message) {
  if (typeof message !== "string") return null;
  const match = message.match(/:\s*(.+)$/);
  return match ? match[1].trim() : message.trim();
}

function isApprovalText(text) {
  if (!text) return false;
  return /\b(needs?|requires?|waiting|awaiting|request(?:ing|ed)?|confirm)\b[\s\S]{0,80}\b(approval|permission|confirmation|confirm|sandbox|escalation)\b/i.test(text)
    || /\b(approval|permission|confirmation|confirm|sandbox|escalation)\b[\s\S]{0,80}\b(needs?|requires?|waiting|awaiting|request(?:ing|ed)?|confirm)\b/i.test(text);
}

async function collectClaudeSnapshot(options = {}) {
  const includeUsage = options.includeUsage !== false;
  const includeQuota = options.includeQuota !== false;
  const roots = options.projectRoots || resolveClaudeProjectRoots(options.env);
  const existingRoots = roots.filter(pathExists);
  const files = existingRoots.flatMap(walkJsonlFiles)
    .sort((a, b) => safeMtimeMs(b) - safeMtimeMs(a));
  const selectedFiles = files.slice(0, options.maxFiles || 30);
  const fileEntries = readJsonlFiles(selectedFiles, options.maxLinesPerFile || 200);
  const latestSessionFile = latestFile(files);
  const latestEvents = latestSessionFile ? readJsonlTail(latestSessionFile, options.maxLines || 240) : [];
  const bridgePath = options.bridgePath || resolveClaudeBridgePath(options.env);
  const bridge = readClaudeBridgeSnapshot(bridgePath);
  const sessions = summarizeClaudeSessions(fileEntries);
  if (!includeUsage) {
    for (const session of sessions) session.usage = null;
  }
  let activeSession = sessions[0] || null;

  if (bridge && bridge.status && bridge.status.sessionId) {
    const session = sessions.find((item) => item.id === bridge.status.sessionId);
    if (session) {
      session.title = bridge.status.sessionName || session.title;
      session.cwd = bridge.status.cwd || session.cwd;
      session.model = bridge.status.model || session.model;
      session.agentName = bridge.status.agentName || null;
      session.source = "claude_statusline";
      session.activity = bridge.activity || session.activity;
      activeSession = session;
    } else {
      activeSession = {
        id: bridge.status.sessionId,
        title: bridge.status.sessionName,
        cwd: bridge.status.cwd,
        project: bridge.status.cwd ? path.basename(bridge.status.cwd) : null,
        updatedAt: bridge.latestEventAt,
        model: bridge.status.model,
        agentName: bridge.status.agentName,
        activity: bridge.activity,
        source: "claude_statusline",
      };
      sessions.unshift(activeSession);
    }
  }

  if (activeSession && !activeSession.activity) {
    activeSession.activity = inferClaudeActivity(latestEvents, bridge);
  }

  return {
    provider: "claude",
    source: {
      projectRoots: existingRoots,
      bridgePath,
      bridgeAvailable: Boolean(bridge),
      latestSessionFile,
    },
    sessions,
    activeSession,
    activity: activeSession && activeSession.activity || inferClaudeActivity(latestEvents, bridge),
    usage: includeUsage ? summarizeClaudeUsage(fileEntries) : null,
    quota: includeQuota && bridge && bridge.status ? {
      source: "claude_statusline",
      rateLimits: bridge.status.rateLimits,
      contextWindow: bridge.status.contextWindow,
    } : null,
    fileStats: {
      projectFiles: files.length,
      scannedFiles: selectedFiles.length,
      latestSessionMtimeMs: latestSessionFile ? safeMtimeMs(latestSessionFile) : null,
    },
  };
}

function projectNameFromFile(filePath) {
  const parent = path.dirname(filePath);
  return path.basename(parent);
}

function compareTimestamp(a, b) {
  const aTime = Date.parse(a || "");
  const bTime = Date.parse(b || "");
  if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0;
  if (!Number.isFinite(aTime)) return -1;
  if (!Number.isFinite(bTime)) return 1;
  return aTime - bTime;
}

function numberFrom(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

module.exports = {
  collectClaudeSnapshot,
  extractClaudeUsage,
  inferClaudeActivity,
  normalizeClaudeHookActivity,
  normalizeClaudeStatusLine,
  parseClaudeEntry,
  readClaudeBridgeSnapshot,
  summarizeClaudeSessions,
  summarizeClaudeUsage,
  summarizeClaudeUsageForSession,
};
