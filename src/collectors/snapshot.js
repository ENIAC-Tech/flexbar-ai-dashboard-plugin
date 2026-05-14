"use strict";

const { collectClaudeSnapshot } = require("./claude");
const { collectCodexSnapshot } = require("./codex");

async function collectAiSnapshot(options = {}) {
  const startedAt = new Date();
  const [codex, claude] = await Promise.all([
    collectCodexSnapshot(options.codex || {}),
    collectClaudeSnapshot(options.claude || {}),
  ]);

  return {
    schemaVersion: 1,
    collectedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt.getTime(),
    providers: {
      codex,
      claude,
    },
  };
}

function compactSnapshot(snapshot) {
  const codex = snapshot.providers.codex;
  const claude = snapshot.providers.claude;

  return {
    collectedAt: snapshot.collectedAt,
    elapsedMs: snapshot.elapsedMs,
    codex: compactProvider(codex),
    claude: compactProvider(claude),
  };
}

function compactProvider(provider) {
  const session = provider.activeSession;
  return {
    state: provider.activity && provider.activity.state,
    detail: provider.activity && provider.activity.detail,
    confidence: provider.activity && provider.activity.confidence,
    title: session && (session.title || session.project || session.id),
    cwd: session && session.cwd,
    updatedAt: session && session.updatedAt,
    latestTurn: provider.usage && provider.usage.latestTurn,
    sessionCount: provider.sessions ? provider.sessions.length : 0,
    files: provider.fileStats,
    source: provider.source,
  };
}

module.exports = {
  collectAiSnapshot,
  compactSnapshot,
};
