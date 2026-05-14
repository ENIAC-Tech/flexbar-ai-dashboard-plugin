"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const UI_DIR = path.join(__dirname, "..", "com.aspen.flexbar-ai-dashboard.plugin", "ui");

test("session config page writes data source into full key data model", () => {
  const component = loadVueComponent("session.vue");
  const { view, emitted } = mountConfigComponent(component, {
    cid: "com.aspen.flexbar-ai-dashboard.session",
    title: "AI Session",
    style: {},
    data: {
      dataSource: "codex",
      sessionTitleMode: "initial",
    },
  });

  view.dataSource = "claude";

  const next = latestModel(emitted);
  assert.equal(next.data.dataSource, "claude");
  assert.equal(next.data.sessionTitleMode, "initial");
  assert.equal(next.dataSource, undefined);
});

test("session config page migrates stale top-level data source from older saves", () => {
  const component = loadVueComponent("session.vue");
  const { view, emitted } = mountConfigComponent(component, {
    cid: "com.aspen.flexbar-ai-dashboard.session",
    title: "AI Session",
    dataSource: "claude",
    data: {
      dataSource: "codex",
      sessionTitleMode: "initial",
    },
  });

  assert.equal(view.dataSource, "claude");

  view.dataSource = "claude";

  const next = latestModel(emitted);
  assert.equal(next.data.dataSource, "claude");
  assert.equal(next.dataSource, undefined);
});

test("plan usage config page writes data source into full key data model", () => {
  const component = loadVueComponent("plan-usage.vue");
  const { view, emitted } = mountConfigComponent(component, {
    cid: "com.aspen.flexbar-ai-dashboard.plan-usage",
    title: "Plan Usage",
    style: {},
    data: {
      dataSource: "codex",
    },
  });

  view.dataSource = "claude";

  const next = latestModel(emitted);
  assert.equal(next.data.dataSource, "claude");
  assert.equal(next.dataSource, undefined);
});

test("plan usage config page migrates stale top-level data source from older saves", () => {
  const component = loadVueComponent("plan-usage.vue");
  const { view, emitted } = mountConfigComponent(component, {
    cid: "com.aspen.flexbar-ai-dashboard.plan-usage",
    title: "Plan Usage",
    dataSource: "claude",
    data: {
      dataSource: "codex",
    },
  });

  assert.equal(view.dataSource, "claude");

  view.dataSource = "claude";

  const next = latestModel(emitted);
  assert.equal(next.data.dataSource, "claude");
  assert.equal(next.dataSource, undefined);
});

test("session and plan config pages read data source from nested config models", () => {
  const session = mountConfigComponent(loadVueComponent("session.vue"), {
    data: {
      config: {
        dataSource: "claude",
      },
    },
  });
  const plan = mountConfigComponent(loadVueComponent("plan-usage.vue"), {
    config: {
      dataSource: "claude",
    },
  });

  assert.equal(session.view.dataSource, "claude");
  assert.equal(plan.view.dataSource, "claude");
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

function mountConfigComponent(component, modelValue) {
  const emitted = [];
  const view = {
    modelValue,
    $emit(event, value) {
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

function latestModel(emitted) {
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, "update:modelValue");
  return emitted[0].value;
}
