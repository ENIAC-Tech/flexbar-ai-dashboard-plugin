"use strict";

function updateSkillConfigModel(modelValue, patch) {
  const model = isObject(modelValue) ? modelValue : {};
  const nextPatch = isObject(patch) ? patch : {};

  if (isObject(model.config)) {
    const config = {
      ...model.config,
      ...nextPatch,
    };
    return withSkillTitle({
      ...model,
      config,
    }, config.skillName);
  }

  if (isFullKeyModelWithData(model)) {
    const data = {
      ...model.data,
      ...nextPatch,
    };
    return withSkillTitle({
      ...model,
      data,
    }, data.skillName);
  }

  return {
    ...model,
    ...nextPatch,
  };
}

function skillNameFromKey(key) {
  return firstNonBlankString(
    key && key.config && key.config.skillName,
    key && key.data && key.data.config && key.data.config.skillName,
    key && key.data && key.data.skillName,
    key && key.modelValue && key.modelValue.config && key.modelValue.config.skillName,
    key && key.modelValue && key.modelValue.skillName
  );
}

function configureDefaultSkillKey(key, fallbackTitle) {
  if (!key) return null;
  const skillName = skillNameFromKey(key);
  key.title = skillName || fallbackTitle || "Select skill";
  key.style = isObject(key.style) ? key.style : {};
  key.style.icon = key.style.icon || "mdi mdi-star-four-points";
  key.style.iconSize = Math.min(Number(key.style.iconSize) || 34, 34);
  key.style.fontSize = Math.min(Number(key.style.fontSize) || 18, 18);
  key.style.iconPos = { X: 50, Y: 50 };
  key.style.titlePos = key.style.titlePos || { X: 50, Y: 72 };
  key.style.showIcon = !skillName;
  key.style.showTitle = true;
  key.style.showImage = false;
  return key;
}

function firstNonBlankString(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function withSkillTitle(model, skillName) {
  const title = String(skillName || "").trim();
  if (!title) return model;
  return {
    ...model,
    title,
  };
}

function isFullKeyModelWithData(model) {
  return isObject(model.data) && (
    Object.prototype.hasOwnProperty.call(model, "cid") ||
    Object.prototype.hasOwnProperty.call(model, "style") ||
    Object.prototype.hasOwnProperty.call(model, "title")
  );
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  configureDefaultSkillKey,
  skillNameFromKey,
  updateSkillConfigModel,
};
