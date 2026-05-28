"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const UI_DIR = path.join(__dirname, "..", "com.aspen.flexbar-ai-dashboard.plugin", "ui");

test("global config page persists through FlexDesigner setConfig", async () => {
  const component = loadVueComponent("global_config.vue");
  const saved = [];
  const setConfigCalls = [];
  const emitted = [];
  const { view } = mountConfigComponent(component, {
    modelValue: { config: {} },
    async sendToBackend(payload) {
      if (payload.type === "savePluginConfig") {
        saved.push(payload.config);
        return { ok: true, config: payload.config };
      }
      if (payload.type === "setupStatus") return { codex: {}, claude: {} };
      if (payload.type === "snapshot") return null;
      if (payload.type === "pathDefaults") return [];
      return {};
    },
    async setConfig(config) {
      setConfigCalls.push(config);
      return { status: "success" };
    },
    emit(event, value) {
      emitted.push({ event, value });
    },
  });

  view.pathFields = [
    {
      key: "CODEX_HOME",
      label: "Codex home",
      resolved: "/Users/test/.codex",
      description: "Overrides CODEX_HOME when set.",
    },
  ];
  view.applyPluginSettings({
    overwriteStatusLine: false,
    pathOverrides: { CODEX_HOME: "/custom/codex" },
  });
  await view.applyPathOverrides();

  assert.equal(saved.length, 1);
  assert.equal(saved[0].pathOverrides.CODEX_HOME, "/custom/codex");
  assert.equal(setConfigCalls.length, 1);
  assert.equal(setConfigCalls[0].pathOverrides.CODEX_HOME, "/custom/codex");
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, "update:modelValue");
  assert.equal(emitted[0].value.config.pathOverrides.CODEX_HOME, "/custom/codex");
});

test("global config page surfaces backend path validation errors", async () => {
  const component = loadVueComponent("global_config.vue");
  const setConfigCalls = [];
  const { view } = mountConfigComponent(component, {
    async sendToBackend(payload) {
      if (payload.type === "savePluginConfig") {
        return {
          ok: false,
          errors: [{ key: "CODEX_HOME", message: "Codex home does not exist: /nope" }],
        };
      }
      return {};
    },
    async setConfig(config) {
      setConfigCalls.push(config);
    },
  });

  view.applyPluginSettings({
    overwriteStatusLine: false,
    pathOverrides: { CODEX_HOME: "/nope" },
  });
  await view.applyPathOverrides();

  assert.equal(view.pathValidationErrors.CODEX_HOME, "Codex home does not exist: /nope");
  assert.match(view.error, /Fix path override errors/);
  assert.equal(setConfigCalls.length, 0);
});

test("global config page prefers hosted modelValue.config over backend defaults", async () => {
  const component = loadVueComponent("global_config.vue");
  const { view } = mountConfigComponent(component, {
    modelValue: {
      config: {
        overwriteStatusLine: true,
        pathOverrides: { CODEX_HOME: "/hosted/codex" },
      },
    },
    async sendToBackend(payload) {
      if (payload.type === "getPluginConfig") {
        return {
          overwriteStatusLine: false,
          pathOverrides: { CODEX_HOME: "/backend/codex" },
        };
      }
      return {};
    },
  });

  await view.loadInitialSettings();

  assert.equal(view.pluginSettings.overwriteStatusLine, true);
  assert.equal(view.pluginSettings.pathOverrides.CODEX_HOME, "/hosted/codex");
});

function loadVueComponent(fileName) {
  const content = fs.readFileSync(path.join(UI_DIR, fileName), "utf8");
  const match = content.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, `${fileName} has a script block`);

  const sandbox = {
    component: null,
    console,
    document: undefined,
  };
  vm.createContext(sandbox);
  vm.runInContext(match[1].replace(/\bexport\s+default\b/, "component ="), sandbox, {
    filename: fileName,
  });
  return sandbox.component;
}

function mountConfigComponent(component, options = {}) {
  const emitted = [];
  const view = {
    modelValue: options.modelValue || { config: {} },
    pathFields: [],
    pluginSettings: {
      overwriteStatusLine: false,
      pathOverrides: {},
    },
    savedPluginSettings: {
      overwriteStatusLine: false,
      pathOverrides: {},
    },
    settingsLoaded: false,
    $fd: {
      sendToBackend: options.sendToBackend || (async () => ({})),
      setConfig: options.setConfig || (async () => ({ status: "success" })),
    },
    $emit(event, value) {
      if (options.emit) {
        options.emit(event, value);
        return;
      }
      emitted.push({ event, value });
    },
  };

  for (const [name, method] of Object.entries(component.methods || {})) {
    view[name] = method.bind(view);
  }

  for (const [name, descriptor] of Object.entries(component.computed || {})) {
    Object.defineProperty(view, name, {
      enumerable: true,
      get: descriptor.get ? descriptor.get.bind(view) : undefined,
      set: descriptor.set ? descriptor.set.bind(view) : undefined,
    });
  }

  return { view, emitted };
}
