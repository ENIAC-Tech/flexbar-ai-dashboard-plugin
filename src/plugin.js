"use strict";

const { plugin, logger } = require("@eniac/flexdesigner");
const { collectAiSnapshot, compactSnapshot } = require("./collectors/snapshot");
const { applyUsageCache, captureUsageCache } = require("./collectors/usageCache");
const { createDashboardState, buildDashboardViewModel, applySessionTitleMode } = require("./dashboard/viewModel");
const {
  renderPlanUsageKey,
  renderResetTimerKey,
  renderSessionKey,
  renderTokenUsageKey,
} = require("./dashboard/render");
const {
  dataSourceFromKey,
  extractInteractionKey,
  extractLoadedKeys,
  languageFromPayload,
  sessionTitleModeFromKey,
  tokenDisplayModeFromKey,
} = require("./dashboard/pluginEvents");
const { DEFAULT_LANGUAGE, t } = require("./dashboard/i18n");
const { applySkillInvocation } = require("./dashboard/skillAction");
const { configureDefaultSkillKey, skillNameFromKey } = require("./dashboard/skillKey");
const { listAiSkills } = require("./collectors/skills");
const {
  getClaudeBridgeStatus,
  installClaudeBridge,
  uninstallClaudeBridge,
} = require("./collectors/claudeBridgeInstall");
const {
  getSetupStatus,
  installAll,
  uninstallAll,
} = require("./collectors/setup");

const SESSION_CID = "com.aspen.flexbar-ai-dashboard.session";
const TOKEN_USAGE_CID = "com.aspen.flexbar-ai-dashboard.token-usage";
const PLAN_USAGE_CID = "com.aspen.flexbar-ai-dashboard.plan-usage";
const SKILL_CID = "com.aspen.flexbar-ai-dashboard.skill";
const RESET_TIMER_CID = "com.aspen.flexbar-ai-dashboard.reset-timer";
const DASHBOARD_CIDS = new Set([SESSION_CID, TOKEN_USAGE_CID, PLAN_USAGE_CID, RESET_TIMER_CID, SKILL_CID]);
const SESSION_INTERVAL_MS = 2_000;
const USAGE_INTERVAL_MS = 30_000;

const keyData = {};
const dashboardKeys = new Map();
const assignedSessionByKey = new Map();
const dashboardState = createDashboardState();
let latestSnapshot = null;
let snapshotTimer = null;
let snapshotInFlight = false;
let usageCache = null;
let lastUsageAt = 0;
let currentLanguage = DEFAULT_LANGUAGE;

plugin.on("ui.message", async (payload) => {
  updateHostLanguage(payload);

  if (payload && payload.type === "language") {
    return { language: currentLanguage };
  }

  if (payload && payload.type === "snapshot") {
    return payload.full ? latestSnapshot : latestSnapshot && compactSnapshot(latestSnapshot);
  }

  if (payload && payload.type === "skills") {
    return listAiSkills({ source: payload.dataSource || payload.source });
  }

  if (payload && payload.type === "claudeBridgeStatus") {
    return getClaudeBridgeStatus();
  }

  if (payload && payload.type === "setupStatus") {
    return getSetupStatus();
  }

  if (payload && payload.type === "installAll") {
    const result = installAll({
      overwriteStatusLine: Boolean(payload.overwriteStatusLine),
    });
    await refreshSnapshot();
    return result;
  }

  if (payload && payload.type === "uninstallAll") {
    const result = uninstallAll();
    await refreshSnapshot();
    return result;
  }

  if (payload && payload.type === "installClaudeBridge") {
    const result = installClaudeBridge({
      overwriteStatusLine: Boolean(payload.overwriteStatusLine),
    });
    await refreshSnapshot();
    return result;
  }

  if (payload && payload.type === "uninstallClaudeBridge") {
    const result = uninstallClaudeBridge();
    await refreshSnapshot();
    return result;
  }

  logger.info("Received message from UI:", payload);
  return "Hello from plugin backend!";
});

plugin.on("device.status", (devices) => {
  logger.info("Device status changed:", devices);
});

plugin.on("plugin.alive", (payload) => {
  logger.info("Plugin alive:", payload);
  updateHostLanguage(payload);
  handleKeysLoaded(payload);
});

plugin.on("device.newPage", (payload) => {
  logger.info("Device newPage:", payload);
  updateHostLanguage(payload);
  handleKeysLoaded(payload);
});

plugin.on("plugin.dead", (payload) => {
  logger.info("Plugin dead:", payload);
  updateHostLanguage(payload);
  handleKeysRemoved(payload);
});

plugin.on("plugin.data", async (payload) => {
  logger.info("Received plugin.data:", payload);
  updateHostLanguage(payload);
  await handleKeyInteraction(payload);
});

plugin.on("device.userData", async (payload) => {
  logger.info("Received device.userData:", payload);
  updateHostLanguage(payload);
  await handleKeyInteraction(payload);
});

plugin.on("plugin.config.updated", (payload) => {
  logger.info("Plugin config updated:", payload);
  updateHostLanguage(payload);
  drawDashboardKeys();
});

function updateHostLanguage(payload) {
  const language = languageFromPayload(payload);
  if (language && language !== currentLanguage) {
    currentLanguage = language;
    drawDashboardKeys();
  }
}

function handleKeysLoaded(payload) {
  const { serialNumber, keys } = extractLoadedKeys(payload);
  if (!serialNumber) {
    logger.warn("Ignoring key load event without serialNumber:", payload);
    return;
  }

  const aliveKeys = new Set(keys.map((key) => key.uid));

  for (const key of keys) {
    keyData[key.uid] = key;

    if (DASHBOARD_CIDS.has(key.cid)) {
      dashboardKeys.set(key.uid, {
        serialNumber: payload.serialNumber,
        key,
        type: dashboardKeyType(key.cid),
      });
      drawLoadingKey(payload.serialNumber, key);
      startSnapshotLoop();
    }
  }

  for (const [uid, item] of dashboardKeys.entries()) {
    if (item.serialNumber === payload.serialNumber && !aliveKeys.has(uid)) {
      dashboardKeys.delete(uid);
      assignedSessionByKey.delete(uid);
    }
  }

  stopSnapshotLoopIfIdle();
}

function handleKeysRemoved(payload) {
  const { serialNumber, keys } = extractLoadedKeys(payload);
  const keyIds = new Set(keys.map((key) => key.uid));

  for (const [uid, item] of dashboardKeys.entries()) {
    const sameDevice = !serialNumber || item.serialNumber === serialNumber;
    const listedKey = keyIds.size === 0 || keyIds.has(uid);
    if (sameDevice && listedKey) {
      dashboardKeys.delete(uid);
      assignedSessionByKey.delete(uid);
      delete keyData[uid];
    }
  }

  stopSnapshotLoopIfIdle();
}

async function handleKeyInteraction(payload) {
  const { serialNumber, key } = extractInteractionKey(payload);
  if (!key || !DASHBOARD_CIDS.has(key.cid)) return;

  if (key.cid === SESSION_CID) {
    const sessionKey = assignedSessionByKey.get(key.uid);
    if (sessionKey) dashboardState.markViewed(sessionKey);
    drawDashboardKeys();
    return;
  }

  if (key.cid === TOKEN_USAGE_CID || key.cid === PLAN_USAGE_CID || key.cid === RESET_TIMER_CID) {
    usageCache = null;
    lastUsageAt = 0;
    refreshSnapshot();
    return;
  }

  if (key.cid === SKILL_CID) {
    const actionKey = keyForAction(key);
    const result = await applySkillInvocation({
      skillName: skillNameFromKey(actionKey),
      platform: process.platform,
    });
    notify(serialNumber, skillActionMessage(result), result.ok ? "success" : "error");
  }
}

function startSnapshotLoop() {
  if (snapshotTimer) return;

  refreshSnapshot();
  snapshotTimer = setInterval(refreshSnapshot, SESSION_INTERVAL_MS);
}

function stopSnapshotLoopIfIdle() {
  if (dashboardKeys.size > 0 || !snapshotTimer) return;
  clearInterval(snapshotTimer);
  snapshotTimer = null;
}

async function refreshSnapshot() {
  if (dashboardKeys.size === 0) {
    stopSnapshotLoopIfIdle();
    return;
  }
  if (snapshotInFlight) return;
  snapshotInFlight = true;

  try {
    const now = Date.now();
    const includeUsage = !usageCache || now - lastUsageAt >= USAGE_INTERVAL_MS;
    latestSnapshot = await collectAiSnapshot({
      codex: {
        appServerTimeoutMs: 2_500,
        includeUsage,
        includeQuota: includeUsage,
      },
      claude: {
        maxFiles: 30,
        maxLinesPerFile: 200,
        includeUsage,
        includeQuota: includeUsage,
      },
    });
    if (includeUsage) {
      usageCache = captureUsageCache(latestSnapshot);
      lastUsageAt = now;
    } else {
      applyUsageCache(latestSnapshot, usageCache);
    }
    logger.info("AI snapshot:", compactSnapshot(latestSnapshot));
  } catch (error) {
    logger.error("Failed to collect AI snapshot:", error);
  } finally {
    snapshotInFlight = false;
    drawDashboardKeys();
  }
}

function drawDashboardKeys() {
  if (!latestSnapshot) {
    for (const { serialNumber, key } of dashboardKeys.values()) {
      if (key.cid === SKILL_CID) {
        drawDefaultSkillKey(serialNumber, key);
      } else {
        drawLoadingKey(serialNumber, key);
      }
    }
    return;
  }

  const sessionItems = Array.from(dashboardKeys.values()).filter((item) => item.type === "session");
  const sessionIndexes = { codex: 0, claude: 0 };
  const sessionModels = {
    codex: buildDashboardViewModel(snapshotForDataSource(latestSnapshot, "codex"), dashboardState, {
      language: currentLanguage,
      sessionSlots: sessionItems.filter((item) => dataSourceFromKey(item.key) === "codex").length,
    }),
    claude: buildDashboardViewModel(snapshotForDataSource(latestSnapshot, "claude"), dashboardState, {
      language: currentLanguage,
      sessionSlots: sessionItems.filter((item) => dataSourceFromKey(item.key) === "claude").length,
    }),
  };

  sessionItems.forEach((item) => {
    const source = dataSourceFromKey(item.key);
    const index = sessionIndexes[source]++;
    const model = sessionModels[source];
    const view = applySessionTitleMode(
      model.sessions[index] || emptySessionView(),
      sessionTitleModeFromKey(item.key)
    );
    if (view.sessionKey) {
      assignedSessionByKey.set(item.key.uid, view.sessionKey);
    } else {
      assignedSessionByKey.delete(item.key.uid);
    }
    drawImageKey(item.serialNumber, item.key, view, renderSessionKey, sessionFallbackTitle(view));
  });

  for (const item of dashboardKeys.values()) {
    if (item.type === "skill") {
      drawDefaultSkillKey(item.serialNumber, item.key);
      continue;
    }

    const model = buildDashboardViewModel(
      snapshotForDataSource(latestSnapshot, dataSourceFromKey(item.key)),
      dashboardState,
      { language: currentLanguage, sessionSlots: 0 }
    );
    if (item.type === "token") {
      drawImageKey(
        item.serialNumber,
        item.key,
        { ...model.totalTokens, mode: tokenDisplayModeFromKey(item.key) },
        renderTokenUsageKey,
        `${t(currentLanguage, "tokenUsageTitle")} ${model.totalTokens.label}`
      );
    } else if (item.type === "plan") {
      drawImageKey(item.serialNumber, item.key, model.planUsage, renderPlanUsageKey, `${t(currentLanguage, "planUsageTitle")} ${model.planUsage.label}`);
    } else if (item.type === "reset") {
      drawImageKey(item.serialNumber, item.key, model.resetTimer, renderResetTimerKey, t(currentLanguage, "resetTimerTitle"));
    }
  }
}

function drawDefaultSkillKey(serialNumber, key) {
  configureDefaultSkillKey(key, skillFallbackTitle(key));
  plugin.draw(serialNumber, key, "draw");
}

function drawImageKey(serialNumber, key, view, renderer, fallbackTitle) {
  key.style.showIcon = false;
  key.style.showTitle = false;
  try {
    const image = renderer(view, { width: keyWidth(key), language: currentLanguage });
    plugin.draw(serialNumber, key, "base64", image);
  } catch (error) {
    logger.error("Failed to render dashboard key image:", error);
    key.style.showTitle = true;
    key.title = fallbackTitle;
    plugin.draw(serialNumber, key, "draw");
  }
}

function drawLoadingKey(serialNumber, key) {
  key.style.showIcon = false;
  key.style.showTitle = true;
  key.title = t(currentLanguage, "loading");
  plugin.draw(serialNumber, key, "draw");
}

function dashboardKeyType(cid) {
  if (cid === SESSION_CID) return "session";
  if (cid === TOKEN_USAGE_CID) return "token";
  if (cid === PLAN_USAGE_CID) return "plan";
  if (cid === RESET_TIMER_CID) return "reset";
  if (cid === SKILL_CID) return "skill";
  return "unknown";
}

function keyWidth(key) {
  return Math.max(60, Math.round(Number(
    key.width ||
    key.style && key.style.width ||
    key.data && key.data.width ||
    240
  )));
}

function emptySessionView() {
  return {
    title: t(currentLanguage, "noSession"),
    tokenLabel: t(currentLanguage, "unknown"),
    statusColor: "gray",
    activity: t(currentLanguage, "noActiveSessions"),
  };
}

function sessionFallbackTitle(view) {
  return `${view.title || "Session"} ${view.tokenLabel || ""}`.trim();
}

function snapshotForDataSource(snapshot, source) {
  const providers = snapshot && snapshot.providers || {};
  const dataSource = source === "claude" ? "claude" : "codex";
  return {
    ...snapshot,
    providers: {
      codex: dataSource === "codex" ? providers.codex : emptyProvider("codex"),
      claude: dataSource === "claude" ? providers.claude : emptyProvider("claude"),
    },
  };
}

function emptyProvider(provider) {
  return {
    provider,
    sessions: [],
    activeSession: null,
    activity: { state: "idle" },
    usage: null,
    quota: null,
  };
}

function skillFallbackTitle(key) {
  return skillNameFromKey(key) || t(currentLanguage, "selectSkill");
}

function skillActionMessage(result) {
  if (!result || !result.ok) return result && result.error || t(currentLanguage, "skillActionFailed");
  if (result.action === "copy") return t(currentLanguage, "promptCopied");
  return t(currentLanguage, "promptPasted");
}

function notify(serialNumber, message, level) {
  if (serialNumber && typeof plugin.showFlexbarSnackbarMessage === "function") {
    plugin.showFlexbarSnackbarMessage(serialNumber, message, level, level === "error" ? "warning" : "ok", 2500, false);
    return;
  }
  if (typeof plugin.showSnackbarMessage === "function") {
    plugin.showSnackbarMessage(level, message, 2500);
  }
}

function keyForAction(key) {
  if (!key || key.uid === undefined || key.uid === null) return key;
  const cached = keyData[key.uid];
  if (!cached || skillNameFromKey(key)) return key;
  return {
    ...key,
    ...cached,
    data: {
      ...(key.data || {}),
      ...(cached.data || {}),
    },
    config: {
      ...(key.config || {}),
      ...(cached.config || {}),
    },
  };
}

plugin.start();
