"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  renderPlanUsageKey,
  renderResetTimerKey,
  renderSessionKey,
  renderSkillKey,
  renderTokenUsageKey,
} = require("../src/dashboard/render");

test("dashboard renderer creates PNG data URLs at dynamic key width and fixed 60px height", () => {
  const fake = createFakeCanvasModule();

  const tokenImage = renderTokenUsageKey({ title: "Tokens", label: "123.4k" }, { width: 320, canvasModule: fake });
  const planImage = renderPlanUsageKey({
    title: "Plan",
    items: [{ label: "5h", remainingPercent: 92, usedPercent: 8 }],
  }, { width: 280, canvasModule: fake });
  const sessionImage = renderSessionKey({
    title: "A very long session title that needs truncation",
    tokenLabel: "12.3k",
    statusColor: "orange",
    activity: "\u7b49\u5f85\u6279\u51c6: npm install",
  }, { width: 520, canvasModule: fake });
  const skillImage = renderSkillKey({
    title: "diagnose",
    sourceLabel: "Codex",
    activity: "Tap to use skill",
  }, { width: 240, canvasModule: fake });

  assert.equal(tokenImage, "data:image/png;base64,fake");
  assert.equal(planImage, "data:image/png;base64,fake");
  assert.equal(sessionImage, "data:image/png;base64,fake");
  assert.equal(skillImage, "data:image/png;base64,fake");
  assert.deepEqual(fake.sizes, [
    { width: 320, height: 60 },
    { width: 280, height: 60 },
    { width: 520, height: 60 },
    { width: 240, height: 60 },
  ]);
});

test("dashboard renderer requires a canvas module and does not fall back to SVG", () => {
  assert.throws(
    () => renderTokenUsageKey({ title: "Tokens", label: "1k" }, { width: 240, canvasModule: null }),
    /@napi-rs\/canvas/
  );
});

test("plan usage bars change color by remaining quota, not row position", () => {
  const fake = createFakeCanvasModule();

  for (const remainingPercent of [80, 30, 8]) {
    renderPlanUsageKey({
      title: "Plan",
      items: [{ label: "5h", remainingPercent, usedPercent: 100 - remainingPercent }],
    }, { width: 320, canvasModule: fake });
  }

  assert.deepEqual(fake.fills.filter((color) => ["#22c55e", "#f59e0b", "#ef4444"].includes(color)), [
    "#22c55e",
    "#f59e0b",
    "#ef4444",
  ]);
});

test("plan usage percent labels sit outside progress bars", () => {
  const fake = createFakeCanvasModule();

  renderPlanUsageKey({
    title: "Plan",
    items: [{ label: "5h", remainingPercent: 92, usedPercent: 8 }],
  }, { width: 280, canvasModule: fake });

  const percent = fake.textDraws.find((text) => text.text === "92%");
  const bar = fake.roundedRects.find((rect) => rect.color === "#27272a" && rect.y === 25);

  assert.ok(bar);
  assert.ok(percent);
  const percentLeft = percent.x - fake.measureTextWidth(percent.text);
  assert.ok(percentLeft > bar.x + bar.width);
});

test("reset timer renders a depleting ring and compact remaining time per window", () => {
  const fake = createFakeCanvasModule();
  const now = 1_000_000_000_000;

  renderResetTimerKey({
    title: "Reset Timer",
    items: [
      { provider: "Codex", label: "5h", resetAtMs: now + 2 * 3600 * 1000, windowSeconds: 5 * 3600 },
      { provider: "Codex", label: "Weekly", resetAtMs: now + 3 * 86400 * 1000, windowSeconds: 7 * 86400 },
    ],
  }, { width: 200, now, canvasModule: fake });

  assert.ok(fake.texts.includes("2h"));
  assert.ok(fake.texts.includes("3d"));
  assert.ok(fake.texts.includes("5h"));
  assert.ok(fake.texts.includes("Weekly"));
  assert.ok(fake.fills.includes("#38bdf8"));
});

test("reset timer empties the ring once the window has passed its reset", () => {
  const fake = createFakeCanvasModule();
  const now = 1_000_000_000_000;

  renderResetTimerKey({
    items: [{ label: "5h", resetAtMs: now - 1000, windowSeconds: 5 * 3600 }],
  }, { width: 200, now, canvasModule: fake });

  assert.ok(fake.texts.includes("<1m"));
  assert.ok(!fake.fills.includes("#38bdf8"));
});

test("reset timer localizes the unavailable state when no windows are known", () => {
  const fake = createFakeCanvasModule();

  renderResetTimerKey({ items: [] }, { width: 200, language: "zh-CN", canvasModule: fake });

  assert.ok(fake.texts.includes("不可用"));
});

test("session key renderer does not draw layout guide borders", () => {
  const fake = createFakeCanvasModule();

  renderSessionKey({
    title: "\u5f00\u53d1 Codex Claude \u7528\u91cf\u63d2\u4ef6",
    tokenLabel: "12.3k",
    statusColor: "blue",
    activity: "\u6b63\u5728\u7f16\u8f91: src/plugin.js",
  }, { width: 520, canvasModule: fake });

  assert.equal(fake.strokeRects, 0);
});

test("session key renderer uses unicode-capable fallback fonts", () => {
  const fake = createFakeCanvasModule();

  renderSessionKey({
    title: "\u5f00\u53d1 Codex Claude \u7528\u91cf\u63d2\u4ef6",
    tokenLabel: "12.3k",
    statusColor: "blue",
    activity: "\u6b63\u5728\u7f16\u8f91: src/plugin.js",
  }, { width: 520, canvasModule: fake });

  assert.ok(fake.fonts.some((font) => font.includes("Microsoft YaHei") || font.includes("PingFang SC") || font.includes("Noto Sans CJK")));
  if (process.platform === "win32") {
    assert.ok(fake.fonts.every((font) => font.indexOf("Microsoft YaHei") < font.indexOf("Segoe UI")));
  }
});

test("dashboard renderer localizes fallback labels", () => {
  const fake = createFakeCanvasModule();

  renderTokenUsageKey({}, { width: 240, language: "zh-CN", canvasModule: fake });
  renderPlanUsageKey({ items: [] }, { width: 240, language: "zh-CN", canvasModule: fake });
  renderSessionKey({}, { width: 240, language: "zh-CN", canvasModule: fake });
  renderSkillKey({}, { width: 240, language: "zh-CN", canvasModule: fake });

  assert.ok(fake.texts.includes("\u4ee4\u724c\u7528\u91cf"));
  assert.ok(fake.texts.includes("\u4e0d\u53ef\u7528"));
  assert.ok(fake.texts.includes("\u672a\u547d\u540d"));
  assert.ok(fake.texts.includes("\u9009\u62e9\u6280\u80fd"));
  assert.ok(fake.texts.includes("\u8f7b\u70b9\u4f7f\u7528\u6280\u80fd"));
});

test("token usage renderer draws recent chart bars", () => {
  const fake = createFakeCanvasModule();

  renderTokenUsageKey({
    mode: "recentChart",
    title: "Token Usage",
    label: "850",
    recentLabel: "Recent usage",
    recent: [
      { value: 100, intensity: 20 },
      { value: 500, intensity: 100 },
      { value: 250, intensity: 50 },
    ],
  }, { width: 240, canvasModule: fake });

  assert.ok(fake.texts.includes("Recent usage"));
  assert.ok(fake.fills.includes("#22c55e"));
  assert.ok(fake.fills.includes("#f59e0b"));

  const bars = fake.roundedRects.filter((rect) => ["#22c55e", "#f59e0b", "#ef4444"].includes(rect.color));
  const valueLabels = ["100", "500", "250"].map((value) => fake.textDraws.find((text) => text.text === value));

  assert.equal(bars.length, 3);
  for (const [index, label] of valueLabels.entries()) {
    assert.ok(label);
    assert.equal(label.align, "center");
    assert.equal(label.x, bars[index].x + bars[index].width / 2);
    assert.ok(label.y > bars[index].y + bars[index].height);
  }
});

test("token usage renderer draws recent chart labels as bottom integers", () => {
  const fake = createFakeCanvasModule();

  renderTokenUsageKey({
    mode: "recentChart",
    recent: [
      { value: 1250, intensity: 100 },
    ],
  }, { width: 240, canvasModule: fake });

  const bar = fake.roundedRects.find((rect) => rect.color === "#ef4444");
  const label = fake.textDraws.find((text) => text.text === "1k");

  assert.ok(bar);
  assert.ok(label);
  assert.equal(label.align, "center");
  assert.ok(label.y > bar.y + bar.height);
  assert.equal(fake.texts.includes("1.3k"), false);
});

test("token usage renderer localizes empty recent chart state", () => {
  const fake = createFakeCanvasModule();

  renderTokenUsageKey({
    mode: "recentChart",
    recent: [],
  }, { width: 240, language: "zh-CN", canvasModule: fake });

  assert.ok(fake.texts.includes("\u6682\u65e0\u8fd1\u671f\u7528\u91cf"));
});

function createFakeCanvasModule() {
  const module = {
    sizes: [],
    fills: [],
    fonts: [],
    texts: [],
    textDraws: [],
    roundedRects: [],
    strokeRects: 0,
    measureTextWidth(text) {
      return String(text).length * 8;
    },
  };
  const contextPrototype = {
    _fillStyle: "",
    _font: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
    textBaseline: "alphabetic",
    _pathBounds: null,
    beginPath() {
      this._pathBounds = null;
    },
    arc() {},
    fill() {
      module.fills.push(this.fillStyle);
      if (this._pathBounds) {
        module.roundedRects.push({
          ...this._pathBounds,
          color: this.fillStyle,
        });
      }
    },
    fillRect() {
      module.fills.push(this.fillStyle);
    },
    strokeRect() {
      module.strokeRects += 1;
    },
    moveTo(x, y) {
      this._recordPoint(x, y);
    },
    lineTo(x, y) {
      this._recordPoint(x, y);
    },
    quadraticCurveTo(cx, cy, x, y) {
      this._recordPoint(cx, cy);
      this._recordPoint(x, y);
    },
    _recordPoint(x, y) {
      if (!this._pathBounds) {
        this._pathBounds = { x, y, width: 0, height: 0 };
        return;
      }
      const minX = Math.min(this._pathBounds.x, x);
      const minY = Math.min(this._pathBounds.y, y);
      const maxX = Math.max(this._pathBounds.x + this._pathBounds.width, x);
      const maxY = Math.max(this._pathBounds.y + this._pathBounds.height, y);
      this._pathBounds = {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    },
    closePath() {},
    clip() {},
    save() {},
    restore() {},
    fillText(text, x, y) {
      module.texts.push(String(text));
      module.textDraws.push({
        text: String(text),
        x,
        y,
        align: this.textAlign,
      });
    },
    measureText(text) {
      return { width: module.measureTextWidth(text) };
    },
  };
  Object.defineProperty(contextPrototype, "fillStyle", {
    get() {
      return this._fillStyle;
    },
    set(value) {
      this._fillStyle = value;
    },
  });
  Object.defineProperty(contextPrototype, "font", {
    get() {
      return this._font;
    },
    set(value) {
      this._font = value;
      module.fonts.push(value);
    },
  });
  module.createCanvas = function createCanvas(width, height) {
    module.sizes.push({ width, height });
    return {
      getContext() {
        return Object.create(contextPrototype);
      },
      toDataURL(type) {
        assert.equal(type, "image/png");
        return "data:image/png;base64,fake";
      },
    };
  };
  return module;
}
