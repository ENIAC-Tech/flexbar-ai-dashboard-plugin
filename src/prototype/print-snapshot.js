"use strict";

const { collectAiSnapshot, compactSnapshot } = require("../collectors/snapshot");
const { applyUsageCache, captureUsageCache } = require("../collectors/usageCache");
const { formatMonitorSnapshot } = require("./monitorFormat");

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_USAGE_INTERVAL_MS = 30_000;

async function main() {
  const args = new Set(process.argv.slice(2));
  const once = args.has("--once");
  const full = args.has("--full");
  const json = args.has("--json");
  const intervalMs = readIntervalMs(process.argv.slice(2));
  const usageIntervalMs = readUsageIntervalMs(process.argv.slice(2));
  let usageCache = null;
  let lastUsageAt = 0;

  let running = false;

  async function runOnce() {
    if (running) {
      process.stderr.write("Skipping snapshot: previous collection is still running\n");
      return;
    }

    running = true;
    try {
      const now = Date.now();
      const includeUsage = !usageCache || now - lastUsageAt >= usageIntervalMs;
      const snapshot = await collectAiSnapshot({
        codex: {
          appServerTimeoutMs: 3_500,
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
        usageCache = captureUsageCache(snapshot);
        lastUsageAt = now;
      } else {
        applyUsageCache(snapshot, usageCache);
      }
      writeSnapshot(snapshot, { full, json });
    } finally {
      running = false;
    }
  }

  await runOnce();

  if (!once) {
    setInterval(() => {
      runOnce().catch((error) => {
        process.stderr.write(`${error.stack || error.message}\n`);
      });
    }, intervalMs);
  }
}

function writeSnapshot(snapshot, options) {
  if (options.json) {
    const output = options.full ? snapshot : compactSnapshot(snapshot);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  process.stdout.write("\n");
  process.stdout.write("=".repeat(100));
  process.stdout.write("\n");
  process.stdout.write(`${formatMonitorSnapshot(snapshot)}\n`);
}

function readIntervalMs(args) {
  const index = args.indexOf("--interval");
  if (index < 0) return DEFAULT_INTERVAL_MS;

  const value = Number(args[index + 1]);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_INTERVAL_MS;
  return value;
}

function readUsageIntervalMs(args) {
  const index = args.indexOf("--usage-interval");
  if (index < 0) return DEFAULT_USAGE_INTERVAL_MS;

  const value = Number(args[index + 1]);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_USAGE_INTERVAL_MS;
  return value;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  DEFAULT_USAGE_INTERVAL_MS,
  applyUsageCache,
  captureUsageCache,
  main,
  readIntervalMs,
  readUsageIntervalMs,
};
