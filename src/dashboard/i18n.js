"use strict";

const DEFAULT_LANGUAGE = "en";
const SUPPORTED_LANGUAGES = new Set(["en", "zh"]);

const MESSAGES = {
  en: {
    activityCompleted: "Completed",
    activityPlanning: "planning...",
    activityWaiting: "Waiting",
    activityThinking: "Thinking",
    activityProcessing: "Processing",
    approvalWaiting: "Waiting for approval",
    configureSkill: "Configure skill",
    loading: "AI loading...",
    noActiveSessions: "No active sessions",
    noSession: "No session",
    planUsageTitle: "Plan Usage",
    promptCopied: "Skill prompt copied",
    promptPasted: "Skill prompt pasted",
    recentUsage: "Recent usage",
    noRecentUsage: "No recent usage",
    selectSkill: "Select skill",
    skillActionFailed: "Skill action failed",
    skillLabel: "Skill",
    tapToUseSkill: "Tap to use skill",
    tokenUsageTitle: "Token Usage",
    unavailable: "unavailable",
    unknown: "unknown",
    untitled: "Untitled",
    toolBashDone: "Just ran command",
    toolBashDoing: "Running command",
    toolEditDone: "Just edited",
    toolEditDoing: "Editing",
    toolGenericDone: "Just used tool",
    toolGenericDoing: "Using tool",
    toolMcpDone: "Just used MCP",
    toolMcpDoing: "Using MCP",
    toolReadDone: "Just read",
    toolReadDoing: "Reading",
    toolSearchDone: "Just searched",
    toolSearchDoing: "Searching",
  },
  zh: {
    activityCompleted: "\u5df2\u5b8c\u6210",
    activityPlanning: "planning...",
    activityWaiting: "\u7b49\u5f85\u4e2d",
    activityThinking: "\u6b63\u5728\u601d\u8003",
    activityProcessing: "\u6b63\u5728\u5904\u7406",
    approvalWaiting: "\u7b49\u5f85\u6279\u51c6",
    configureSkill: "\u914d\u7f6e\u6280\u80fd",
    loading: "AI \u52a0\u8f7d\u4e2d...",
    noActiveSessions: "\u6ca1\u6709\u6d3b\u8dc3\u4f1a\u8bdd",
    noSession: "\u65e0\u4f1a\u8bdd",
    planUsageTitle: "\u5957\u9910\u7528\u91cf",
    promptCopied: "\u5df2\u590d\u5236\u6280\u80fd\u63d0\u793a\u8bcd",
    promptPasted: "\u5df2\u7c98\u8d34\u6280\u80fd\u63d0\u793a\u8bcd",
    recentUsage: "\u8fd1\u671f\u7528\u91cf",
    noRecentUsage: "\u6682\u65e0\u8fd1\u671f\u7528\u91cf",
    selectSkill: "\u9009\u62e9\u6280\u80fd",
    skillActionFailed: "\u6280\u80fd\u64cd\u4f5c\u5931\u8d25",
    skillLabel: "\u6280\u80fd",
    tapToUseSkill: "\u8f7b\u70b9\u4f7f\u7528\u6280\u80fd",
    tokenUsageTitle: "\u4ee4\u724c\u7528\u91cf",
    unavailable: "\u4e0d\u53ef\u7528",
    unknown: "\u672a\u77e5",
    untitled: "\u672a\u547d\u540d",
    toolBashDone: "\u521a\u5b8c\u6210\u8fd0\u884c\u547d\u4ee4",
    toolBashDoing: "\u6b63\u5728\u8fd0\u884c\u547d\u4ee4",
    toolEditDone: "\u521a\u5b8c\u6210\u7f16\u8f91",
    toolEditDoing: "\u6b63\u5728\u7f16\u8f91",
    toolGenericDone: "\u521a\u5b8c\u6210\u4f7f\u7528\u5de5\u5177",
    toolGenericDoing: "\u6b63\u5728\u4f7f\u7528\u5de5\u5177",
    toolMcpDone: "\u521a\u5b8c\u6210\u4f7f\u7528 MCP",
    toolMcpDoing: "\u6b63\u5728\u4f7f\u7528 MCP",
    toolReadDone: "\u521a\u5b8c\u6210\u8bfb\u53d6",
    toolReadDoing: "\u6b63\u5728\u8bfb\u53d6",
    toolSearchDone: "\u521a\u5b8c\u6210\u641c\u7d22",
    toolSearchDoing: "\u6b63\u5728\u641c\u7d22",
  },
};

function normalizeLanguage(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_LANGUAGE;
  const text = String(value).trim().toLowerCase().replace("_", "-");
  if (text.startsWith("zh")) return "zh";
  if (text.startsWith("en")) return "en";
  return DEFAULT_LANGUAGE;
}

function languageFromPayload(payload) {
  const value = findLanguageValue(payload);
  return value === null ? null : normalizeLanguage(value);
}

function findLanguageValue(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return null;

  for (const key of ["language", "locale", "lang"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      return value[key];
    }
  }

  for (const key of ["host", "app", "application", "system", "config", "settings", "data", "payload"]) {
    const nested = findLanguageValue(value[key], depth + 1);
    if (nested !== null) return nested;
  }

  return null;
}

function t(language, key) {
  const normalized = normalizeLanguage(language);
  return (MESSAGES[normalized] && MESSAGES[normalized][key]) || MESSAGES[DEFAULT_LANGUAGE][key] || key;
}

module.exports = {
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGES,
  languageFromPayload,
  normalizeLanguage,
  t,
};
