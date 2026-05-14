"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { summarizeReasoning, summarizeToolAction } = require("./actionSummary");
const { latestFile, readJsonlTail, safeMtimeMs, walkJsonlFiles } = require("./jsonl");
const { resolveCodexHome } = require("./paths");

const CODEX_ACTIVITY_STALE_MS = 30_000;
const CODEX_OPEN_TURN_STALE_MS = 30 * 60_000;
const CODEX_SESSION_TAIL_LINES = 500;
const RECENT_TOKEN_EVENTS_LIMIT = 10;

function parseCodexEvent(entry) {
  const payload = entry && entry.payload ? entry.payload : {};
  const type = entry ? entry.type : null;
  const payloadType = payload.type || null;

  return {
    timestamp: entry && entry.timestamp ? entry.timestamp : null,
    type,
    payloadType,
    toolName: payload.name || payload.tool_name || null,
    callId: payload.call_id || null,
    arguments: payload.arguments || payload.input || payload.arguments_json || null,
    approvalRequest: extractApprovalRequest(entry),
    reasoningSummary: payloadType === "reasoning" ? summarizeReasoning(entry) : null,
    usage: extractCodexUsage(payload),
    messageText: extractPayloadText(payload),
  };
}

function extractCodexUsage(payload) {
  if (!payload || payload.type !== "token_count") return null;

  const info = payload.info || {};
  const last = info.last_token_usage || info.last_token_usage_info || {};
  const total = info.total_token_usage || info.total_token_usage_info || {};
  const hasLastUsage = Object.keys(last).length > 0;
  const usage = hasLastUsage ? last : total;

  return {
    inputTokens: numberFrom(usage.input_tokens),
    cachedInputTokens: numberFrom(usage.cached_input_tokens ?? usage.cache_read_input_tokens),
    outputTokens: numberFrom(usage.output_tokens),
    reasoningOutputTokens: numberFrom(usage.reasoning_output_tokens),
    totalTokens: numberFrom(usage.total_tokens),
    ...hasLastUsage ? {} : { cumulative: true },
  };
}

function extractApprovalRequest(entry) {
  const payload = entry && entry.payload || {};
  const toolName = payload.tool_name || payload.toolName || payload.name || payload.tool || null;
  const command = payload.command || payload.cmd || null;
  const input = payload.tool_input || payload.toolInput || payload.input || payload.arguments || payload.arguments_json || null;
  const parsedInput = parseToolInput(input);

  if (requiresUserApproval(parsedInput)) {
    const detail = toolName || "approval";
    return {
      detail,
      action: summarizeToolAction(detail, parsedInput),
    };
  }

  if (!looksLikeApprovalRequest(entry, payload)) return null;

  const detail = toolName || (command ? "command" : payload.type || entry.type || "approval");
  const action = command ? String(command) : summarizeToolAction(detail, parsedInput) || extractApprovalActionText(payload) || null;

  return {
    detail,
    action,
  };
}

function parseToolInput(rawInput) {
  if (!rawInput) return {};
  if (typeof rawInput === "object") return rawInput;
  if (typeof rawInput !== "string") return {};

  try {
    return JSON.parse(rawInput);
  } catch {
    return { value: rawInput };
  }
}

function requiresUserApproval(input) {
  if (!input || typeof input !== "object") return false;
  return input.sandbox_permissions === "require_escalated"
    || input.sandboxPermissions === "require_escalated";
}

function looksLikeApprovalRequest(entry, payload) {
  const structuralText = [
    entry && entry.type,
    payload && payload.type,
    payload && payload.kind,
    payload && payload.status,
    payload && payload.event,
  ].filter(Boolean).join(" ");

  if (/\b(approval|permission|confirm|confirmation|escalat|sandbox)[_-]?(request|required|needed|prompt|pending)?\b/i.test(structuralText)) {
    return true;
  }

  return isApprovalText(extractApprovalActionText(payload));
}

function extractApprovalActionText(payload) {
  const candidates = [
    payload && payload.message,
    payload && payload.detail,
    payload && payload.reason,
    payload && payload.description,
    payload && payload.prompt,
  ];

  return candidates.map((value) => typeof value === "string" ? value : "").find(Boolean) || "";
}

function isApprovalText(text) {
  if (!text) return false;
  return /\b(needs?|requires?|waiting|awaiting|request(?:ing|ed)?|confirm)\b[\s\S]{0,80}\b(approval|permission|confirmation|confirm|sandbox|escalation)\b/i.test(text)
    || /\b(approval|permission|confirmation|confirm|sandbox|escalation)\b[\s\S]{0,80}\b(needs?|requires?|waiting|awaiting|request(?:ing|ed)?|confirm)\b/i.test(text);
}

function inferCodexActivity(events, now = Date.now()) {
  const allParsed = events.map(parseCodexEvent).filter((event) => event.timestamp);
  const turn = currentCodexTurn(allParsed);
  const parsed = turn.events;
  const latest = parsed.at(-1) || allParsed.at(-1) || null;
  if (!latest) {
    return {
      state: "unknown",
      detail: "no session events",
      lastEventAt: null,
      staleMs: null,
    };
  }

  const latestMs = Date.parse(latest.timestamp);
  const staleMs = Number.isFinite(latestMs) ? now - latestMs : null;

  if (isTerminalPayload(latest.payloadType)) {
    return {
      state: "idle",
      detail: latest.payloadType,
      lastEventAt: latest.timestamp,
      staleMs,
    };
  }

  const openCall = findOpenFunctionCall(parsed);
  if (openCall) {
    if (openCall.approvalRequest) {
      return {
        state: "approval",
        detail: openCall.approvalRequest.detail,
        action: openCall.approvalRequest.action,
        lastEventAt: latest.timestamp,
        staleMs,
      };
    }
    return {
      state: "tool",
      detail: openCall.toolName || "function_call",
      action: summarizeToolAction(openCall.toolName || "function_call", openCall.arguments),
      lastEventAt: latest.timestamp,
      staleMs,
    };
  }

  if (!turn.isOpen && staleMs !== null && staleMs > CODEX_ACTIVITY_STALE_MS) {
    return {
      state: "idle",
      detail: "no recent Codex event",
      lastEventAt: latest.timestamp,
      staleMs,
    };
  }

  if (turn.isOpen && staleMs !== null && staleMs > CODEX_OPEN_TURN_STALE_MS) {
    return {
      state: "idle",
      detail: "no recent Codex event",
      lastEventAt: latest.timestamp,
      staleMs,
    };
  }

  if (latest.approvalRequest) {
    return {
      state: "approval",
      detail: latest.approvalRequest.detail,
      action: latest.approvalRequest.action,
      lastEventAt: latest.timestamp,
      staleMs,
    };
  }

  if (latest.payloadType === "reasoning") {
    return {
      state: "thinking",
      detail: "reasoning",
      action: latest.reasoningSummary || "thinking",
      lastEventAt: latest.timestamp,
      staleMs,
    };
  }

  if (latest.payloadType === "web_search_call") {
    return {
      state: "tool",
      detail: "web_search",
      lastEventAt: latest.timestamp,
      staleMs,
    };
  }

  if (isToolOutput(latest.payloadType)) {
    const completedCall = findCompletedFunctionCall(parsed, latest);
    return {
      state: "waiting",
      detail: completedCall && completedCall.toolName || latest.payloadType,
      action: completedCall ? summarizeToolAction(completedCall.toolName || "function_call", completedCall.arguments) : null,
      lastEventAt: latest.timestamp,
      staleMs,
    };
  }

  if (latest.payloadType === "token_count") {
    return {
      state: "planning",
      detail: "planning",
      action: "planning...",
      lastEventAt: latest.timestamp,
      staleMs,
    };
  }

  return {
    state: "active",
    detail: latest.payloadType || latest.type,
    lastEventAt: latest.timestamp,
    staleMs,
  };
}

function currentCodexTurn(parsedEvents) {
  const latestStartIndex = findLastIndex(parsedEvents, (event) => event.payloadType === "task_started");
  const events = latestStartIndex >= 0 ? parsedEvents.slice(latestStartIndex) : parsedEvents;
  const latestTerminalIndex = findLastIndex(events, (event) => isTerminalPayload(event.payloadType));

  return {
    events,
    isOpen: latestStartIndex >= 0 && latestTerminalIndex < 0,
  };
}

function findOpenFunctionCall(parsedEvents) {
  const open = new Map();

  for (const event of parsedEvents) {
    if (isTerminalPayload(event.payloadType)) {
      open.clear();
      continue;
    }

    if (isToolCall(event.payloadType)) {
      open.set(event.callId || `index:${open.size}`, event);
    }

    if (isToolOutput(event.payloadType)) {
      if (event.callId && open.has(event.callId)) {
        open.delete(event.callId);
      } else {
        const latestKey = Array.from(open.keys()).at(-1);
        if (latestKey) open.delete(latestKey);
      }
    }
  }

  return Array.from(open.values()).at(-1) || null;
}

function findCompletedFunctionCall(parsedEvents, outputEvent) {
  const outputIndex = parsedEvents.indexOf(outputEvent);
  const searchEvents = outputIndex >= 0 ? parsedEvents.slice(0, outputIndex) : parsedEvents;

  if (outputEvent.callId) {
    const matched = [...searchEvents].reverse().find((event) => {
      return isToolCall(event.payloadType) && event.callId === outputEvent.callId;
    });
    if (matched) return matched;
  }

  return [...searchEvents].reverse().find((event) => isToolCall(event.payloadType)) || null;
}

function isToolCall(payloadType) {
  return payloadType === "function_call" || payloadType === "custom_tool_call" || payloadType === "mcp_tool_call";
}

function isToolOutput(payloadType) {
  return payloadType === "function_call_output" || payloadType === "custom_tool_call_output" || payloadType === "mcp_tool_call_output";
}

function isTerminalPayload(payloadType) {
  return payloadType === "task_complete" || payloadType === "turn_aborted" || payloadType === "thread_rolled_back";
}

function summarizeCodexUsage(events) {
  const parsed = events.map(parseCodexEvent);
  const usageEvents = parsed.filter((event) => event.usage);
  const latestUsage = usageEvents.map((event) => event.usage).at(-1) || null;

  return {
    latestTurn: latestUsage,
    observedTokenEvents: usageEvents.length,
    recentTokenEvents: usageEvents.slice(-RECENT_TOKEN_EVENTS_LIMIT).map((event) => ({
      timestamp: event.timestamp,
      ...event.usage,
      totalTokens: usageTotal(event.usage),
    })),
  };
}

function usageTotal(usage) {
  const total = Number(usage && usage.totalTokens);
  if (Number.isFinite(total)) return total;
  return Object.values(usage || {}).reduce((sum, value) => {
    return sum + (Number.isFinite(Number(value)) ? Number(value) : 0);
  }, 0);
}

function readCodexSessionIndex(codexHome, maxLines = 80) {
  const indexPath = path.join(codexHome, "session_index.jsonl");
  if (!fs.existsSync(indexPath)) return [];

  const lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.slice(-maxLines).map((line) => {
    try {
      const entry = JSON.parse(line);
      return {
        id: entry.id || null,
        title: entry.thread_name || entry.title || null,
        updatedAt: entry.updated_at || entry.updatedAt || null,
        source: "session_index",
      };
    } catch {
      return null;
    }
  }).filter(Boolean).reverse();
}

function readCodexSessionsFromFiles(files, codexHome, options = {}) {
  const includeUsage = options.includeUsage !== false;
  const indexed = new Map(readCodexSessionIndex(codexHome, 400).map((session) => [session.id, session]));
  const sessions = [];
  const seen = new Set();

  for (const filePath of files) {
    const id = codexSessionIdFromFile(filePath);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const indexedSession = indexed.get(id) || {};
    const metadata = readCodexFileMetadata(filePath, id, indexed);
    const events = readJsonlTail(filePath, CODEX_SESSION_TAIL_LINES);
    const lastActivityAt = latestCodexEventTimestamp(events);
    sessions.push({
      id,
      title: indexedSession.title || metadata.title || id,
      latestTitle: deriveLatestCodexTitleFromEvents(events),
      cwd: metadata.cwd || null,
      internal: metadata.internal,
      updatedAt: lastActivityAt || indexedSession.updatedAt || new Date(safeMtimeMs(filePath)).toISOString(),
      lastActivityAt,
      source: "codex_session_file",
      latestSessionFile: filePath,
      activity: inferCodexActivity(events),
      usage: includeUsage ? summarizeCodexUsage(events) : null,
    });
  }

  return sessions;
}

function readCodexFileMetadata(filePath, sessionId, indexed) {
  const events = readJsonlHead(filePath, 120);
  const metas = events
    .filter((entry) => entry && entry.type === "session_meta" && entry.payload)
    .map((entry) => entry.payload);
  const ownMeta = metas.find((meta) => meta.id === sessionId) || metas[0] || {};
  const parentTitle = ownMeta.forked_from_id && indexed.get(ownMeta.forked_from_id)
    ? indexed.get(ownMeta.forked_from_id).title
    : null;

  return {
    title: parentTitle || deriveCodexTitleFromEvents(events),
    cwd: ownMeta.cwd || null,
    internal: isInternalCodexSession(events),
  };
}

function deriveCodexTitleFromEvents(events) {
  for (const event of events) {
    const parsed = parseCodexEvent(event);
    if (!isUserMessageEvent(parsed)) continue;

    const title = summarizeTitleText(parsed.messageText);
    if (title) return title;
  }
  return null;
}

function isUserMessageEvent(event) {
  if (!event) return false;
  return event.payloadType === "user_message";
}

function summarizeTitleText(text) {
  const cleaned = String(text || "")
    .replace(/\[\$[^\]]+\]\([^)]*\)/g, "")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, "")
    .replace(/<ide_selection>[\s\S]*?<\/ide_selection>/gi, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !isLowSignalTitleLine(line));

  if (!cleaned) return null;
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}...` : cleaned;
}

function isLowSignalTitleLine(line) {
  return /^The user selected the lines\b/i.test(line)
    || /^The following is the Codex agent history added since your last approval assessment\b/i.test(line)
    || /^<command-name>/i.test(line)
    || /^@[\w./\\-]+/.test(line)
    || /^Plugin updates available:/i.test(line);
}

function isInternalCodexSession(events) {
  return events.some((event) => {
    const parsed = parseCodexEvent(event);
    return isUserMessageEvent(parsed)
      && /^The following is the Codex agent history added since your last approval assessment\b/i.test(parsed.messageText || "");
  });
}

function codexSessionIdFromFile(filePath) {
  const base = path.basename(filePath, ".jsonl");
  const uuidMatch = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (uuidMatch) return uuidMatch[1];

  const fallback = base.replace(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}[-:]\d{2}[-:]\d{2}(?:-\d+)?-/i, "");
  return fallback && fallback !== base ? fallback : null;
}

function buildCodexFileSession(latestSessionFile, events, options = {}) {
  if (!latestSessionFile) return null;

  const activity = inferCodexActivity(events);
  return {
    sessionId: codexSessionIdFromFile(latestSessionFile),
    latestTitle: deriveLatestCodexTitleFromEvents(events),
    activity,
    usage: options.includeUsage === false ? null : summarizeCodexUsage(events),
    latestSessionFile,
  };
}

function deriveLatestCodexTitleFromEvents(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const parsed = parseCodexEvent(events[index]);
    if (!isUserMessageEvent(parsed)) continue;

    const title = summarizeTitleText(parsed.messageText);
    if (title) return title;
  }
  return null;
}

function latestCodexEventTimestamp(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const timestamp = events[index] && events[index].timestamp;
    if (timestamp && Number.isFinite(Date.parse(timestamp))) return timestamp;
  }
  return null;
}

function chooseActiveCodexSession(sessions, fileSession) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;

  const visibleSessions = sessions.filter((session) => !isArchivedSession(session));
  const targetId = fileSession && fileSession.sessionId;
  const matched = targetId ? visibleSessions.find((session) => session.id === targetId) : null;
  const active = matched || visibleSessions[0] || sessions[0];
  const useFileSession = fileSession && targetId && active && active.id === targetId;

  return {
    ...active,
    latestTitle: useFileSession && fileSession.latestTitle || active.latestTitle || null,
    activity: useFileSession && fileSession.activity || active.activity,
    usage: useFileSession && fileSession.usage || active.usage,
    latestSessionFile: useFileSession && fileSession.latestSessionFile || active.latestSessionFile,
  };
}

function attachCodexSessionDetails(sessions, activeSession) {
  return sessions
    .filter((session) => !isArchivedSession(session))
    .map((session) => {
      if (activeSession && session.id === activeSession.id) {
        return { ...session, ...activeSession };
      }
      return session;
    });
}

function isArchivedSession(session) {
  if (!session) return false;
  if (session.internal === true) return true;
  if (session.archived === true) return true;
  if (session.status && session.status.type === "archived") return true;
  if (session.source && typeof session.source === "string" && session.source.includes("archived")) return true;
  return false;
}

async function collectCodexAppServer({ codexHome, timeoutMs = 3_500, includeQuota = true } = {}) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      CODEX_HOME: codexHome || resolveCodexHome(),
    };
    const child = spawn("codex", ["app-server"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let id = 1;
    let buffer = "";
    let stderr = "";
    const result = {
      source: "codex_app_server",
      available: false,
      codexHome: env.CODEX_HOME,
      threads: [],
      quota: null,
      errors: [],
    };

    const send = (method, params) => {
      child.stdin.write(`${JSON.stringify({ id: id++, method, params })}\n`);
    };
    const notify = (method, params) => {
      child.stdin.write(`${JSON.stringify({ method, params })}\n`);
    };

    const finish = () => {
      if (stderr) result.errors.push(stderr.slice(0, 300));
      child.kill();
      resolve(result);
    };

    const timer = setTimeout(finish, timeoutMs);

    child.on("error", (error) => {
      result.errors.push(error.message);
      clearTimeout(timer);
      resolve(result);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;

        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }

        if (message.id === 1) {
          if (message.error) result.errors.push(message.error.message);
          result.available = !message.error;
          notify("initialized", {});
          send("thread/list", { limit: 20, archived: false });
          if (includeQuota) send("account/rateLimits/read", {});
        } else if (message.id === 2) {
          if (message.error) result.errors.push(message.error.message);
          result.threads = (message.result && message.result.data || []).map(normalizeCodexThread);
          if (!includeQuota) {
            clearTimeout(timer);
            finish();
          }
        } else if (message.id === 3) {
          if (message.error) {
            result.errors.push(message.error.message);
          } else {
            result.quota = normalizeCodexQuota(message.result);
          }
          clearTimeout(timer);
          finish();
        }
      }
    });

    send("initialize", {
      clientInfo: { name: "flexbar-ai-dashboard", version: "1.0.0" },
      capabilities: { experimentalApi: true },
    });
  });
}

function normalizeCodexThread(thread) {
  return {
    id: thread.id || null,
    title: thread.name || thread.title || null,
    cwd: thread.cwd || null,
    path: thread.path || null,
    status: thread.status || null,
    updatedAt: thread.updatedAt || thread.updated_at || null,
    source: "codex_app_server",
  };
}

function normalizeCodexQuota(raw) {
  if (!raw || typeof raw !== "object") return null;

  const limits = collectQuotaLimits(raw);

  return {
    source: "codex_app_server",
    shape: Object.keys(raw),
    limits: limits.filter((limit) => limit.usedPercent !== null || limit.resetAt),
  };
}

function loadCodexOAuthCredentials(codexHome) {
  const authPath = path.join(codexHome, "auth.json");
  let auth;
  try {
    auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
  } catch (error) {
    return {
      available: false,
      authPath,
      error: error.message,
    };
  }

  const tokens = auth.tokens || {};
  const accessToken = tokens.access_token || tokens.accessToken || auth.access_token || auth.accessToken || null;
  const accountId = tokens.account_id || tokens.accountId || auth.account_id || auth.accountId || null;

  return {
    available: Boolean(accessToken),
    authPath,
    accessToken,
    accountId,
  };
}

async function collectCodexOAuthQuota({ codexHome, timeoutMs = 6_000 } = {}) {
  const credentials = loadCodexOAuthCredentials(codexHome || resolveCodexHome());
  if (!credentials.available) {
    return {
      source: "codex_oauth",
      available: false,
      quota: null,
      errors: [credentials.error || "Codex OAuth token not found"],
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      "Authorization": `Bearer ${credentials.accessToken}`,
      "User-Agent": "codex-cli",
    };
    if (credentials.accountId) headers["ChatGPT-Account-Id"] = credentials.accountId;

    const response = await fetch("https://chatgpt.com/backend-api/wham/usage", {
      headers,
      signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok) {
      return {
        source: "codex_oauth",
        available: false,
        quota: null,
        errors: [`HTTP ${response.status}`],
      };
    }

    return {
      source: "codex_oauth",
      available: true,
      quota: {
        ...normalizeCodexQuota(body),
        source: "codex_oauth",
      },
      errors: [],
    };
  } catch (error) {
    return {
      source: "codex_oauth",
      available: false,
      quota: null,
      errors: [error.name === "AbortError" ? "request timeout" : error.message],
    };
  } finally {
    clearTimeout(timer);
  }
}

function collectQuotaLimits(raw) {
  const limits = [];
  const seen = new Set();

  function visit(value, pathParts) {
    if (!value || typeof value !== "object") return;

    const usedPercent = numberOrNull(value.used_percent ?? value.usedPercent ?? value.utilization);
    const resetAt = value.reset_at || value.resetAt || value.resets_at || value.resetsAt || null;
    if (usedPercent !== null || resetAt) {
      const label = value.label || value.display_name || value.displayName || value.name || labelFromQuotaPath(pathParts);
      const key = `${label}:${usedPercent}:${resetAt}`;
      if (!seen.has(key)) {
        seen.add(key);
        limits.push({
          id: value.id || value.limit_id || value.limitId || value.name || label,
          label,
          usedPercent,
          resetAt,
          window: value.window_name || value.windowName || null,
        });
      }
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === "object") {
        visit(child, pathParts.concat(key));
      }
    }
  }

  visit(raw, []);
  return limits;
}

function cleanQuotaPath(pathParts) {
  const filtered = pathParts.filter((part) => {
    return !["rateLimits", "rateLimitsByLimitId", "windows", "window", "primary_window", "primaryWindow", "secondary_window", "secondaryWindow"].includes(part);
  });
  return filtered.join(".") || pathParts.at(-1) || "limit";
}

function labelFromQuotaPath(pathParts) {
  const joined = pathParts.join(".");
  if (/primary_window|primaryWindow/.test(joined)) {
    return "primary";
  }
  if (/secondary_window|secondaryWindow/.test(joined)) {
    return "secondary";
  }
  if (joined === "rate_limit" || joined.endsWith(".rate_limit") && !joined.includes("additional_rate_limits")) {
    return "primary";
  }
  return cleanQuotaPath(pathParts);
}

async function collectCodexSnapshot(options = {}) {
  const includeUsage = options.includeUsage !== false;
  const includeQuota = options.includeQuota !== false;
  const codexHome = options.codexHome || resolveCodexHome(options.env);
  const sessionRoot = path.join(codexHome, "sessions");
  const files = walkJsonlFiles(sessionRoot);
  const latestSessionFile = latestFile(files);
  const latestEvents = latestSessionFile ? readJsonlTail(latestSessionFile, options.maxLines || CODEX_SESSION_TAIL_LINES) : [];
  const latestFileSession = buildCodexFileSession(latestSessionFile, latestEvents, { includeUsage });
  const appServer = options.skipAppServer ? null : await collectCodexAppServer({
    codexHome,
    timeoutMs: options.appServerTimeoutMs || 3_500,
    includeQuota,
  });
  const appServerQuota = includeQuota && appServer && appServer.quota && appServer.quota.limits && appServer.quota.limits.length > 0
    ? appServer.quota
    : null;
  const oauthQuota = appServerQuota || !includeQuota || options.skipOAuthQuota ? null : await collectCodexOAuthQuota({
    codexHome,
    timeoutMs: options.oauthTimeoutMs || 6_000,
  });
  const rawSessions = appServer && appServer.threads.length > 0
    ? appServer.threads
    : readCodexSessionsFromFiles(files, codexHome, { includeUsage });
  const activeSession = chooseActiveCodexSession(rawSessions, latestFileSession);
  const sessions = attachCodexSessionDetails(rawSessions, activeSession);

  return {
    provider: "codex",
    source: {
      codexHome,
      sessionRoot,
      latestSessionFile,
      appServer: appServer ? {
        available: appServer.available,
        errors: appServer.errors,
      } : null,
      oauthQuota: oauthQuota ? {
        available: oauthQuota.available,
        errors: oauthQuota.errors,
      } : null,
    },
    sessions,
    activeSession,
    activity: activeSession && activeSession.activity || inferCodexActivity(latestEvents),
    usage: includeUsage ? activeSession && activeSession.usage || summarizeCodexUsage(latestEvents) : null,
    quota: appServerQuota || oauthQuota && oauthQuota.quota || null,
    fileStats: {
      sessionFiles: files.length,
      latestSessionMtimeMs: latestSessionFile ? safeMtimeMs(latestSessionFile) : null,
    },
  };
}

function numberFrom(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function readJsonlHead(filePath, maxLines = 80) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  return content.split(/\r?\n/).filter(Boolean).slice(0, maxLines).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function extractPayloadText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.text === "string") return payload.text;
  if (Array.isArray(payload.content)) {
    return payload.content.map((item) => {
      if (!item || typeof item !== "object") return "";
      return item.text || item.input_text || "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

function findLastIndex(values, predicate) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index], index)) return index;
  }
  return -1;
}

module.exports = {
  collectCodexAppServer,
  collectCodexSnapshot,
  collectCodexOAuthQuota,
  chooseActiveCodexSession,
  inferCodexActivity,
  loadCodexOAuthCredentials,
  normalizeCodexQuota,
  parseCodexEvent,
  readCodexSessionIndex,
  readCodexSessionsFromFiles,
  summarizeCodexUsage,
};
