"use strict";

function captureUsageCache(snapshot) {
  const providers = snapshot.providers || {};
  return Object.fromEntries(Object.entries(providers).map(([name, provider]) => {
    return [name, {
      usage: provider.usage || null,
      quota: provider.quota || null,
      sessions: Object.fromEntries((provider.sessions || []).map((session) => {
        return [session.id, { usage: session.usage || null }];
      })),
    }];
  }));
}

function applyUsageCache(snapshot, cache) {
  if (!cache) return snapshot;

  for (const [name, provider] of Object.entries(snapshot.providers || {})) {
    const cached = cache[name];
    if (!cached) continue;

    provider.usage = cached.usage;
    provider.quota = cached.quota;
    for (const session of provider.sessions || []) {
      const cachedSession = cached.sessions && cached.sessions[session.id];
      if (cachedSession) session.usage = cachedSession.usage;
    }
    if (provider.activeSession && provider.activeSession.id) {
      const cachedActive = cached.sessions && cached.sessions[provider.activeSession.id];
      if (cachedActive) provider.activeSession.usage = cachedActive.usage;
    }
  }

  return snapshot;
}

module.exports = {
  applyUsageCache,
  captureUsageCache,
};
