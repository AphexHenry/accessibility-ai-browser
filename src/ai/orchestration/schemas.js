'use strict';

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string';
}

function validateM1Output(value) {
  if (!isObject(value)) return { ok: false, reason: 'M1 output must be an object.' };
  if (value.scope !== 'general' && value.scope !== 'page_related') {
    return { ok: false, reason: 'M1 scope must be "general" or "page_related".' };
  }
  if (typeof value.confidence !== 'number' || Number.isNaN(value.confidence)) {
    return { ok: false, reason: 'M1 confidence must be a number.' };
  }
  if (!isString(value.rationale)) {
    return { ok: false, reason: 'M1 rationale must be a string.' };
  }
  return { ok: true };
}

function validateM4Output(value) {
  if (!isObject(value)) return { ok: false, reason: 'M4 output must be an object.' };
  if (typeof value.has_enough_info !== 'boolean') {
    return { ok: false, reason: 'M4 has_enough_info must be a boolean.' };
  }
  if (!(value.missing === null || isString(value.missing))) {
    return { ok: false, reason: 'M4 missing must be string|null.' };
  }
  if (!(value.followup_question === null || isString(value.followup_question))) {
    return { ok: false, reason: 'M4 followup_question must be string|null.' };
  }
  return { ok: true };
}

function validateM5Output(value) {
  if (!isObject(value)) return { ok: false, reason: 'M5 output must be an object.' };
  if (!isString(value.pageSnapshot)) {
    return { ok: false, reason: 'M5 pageSnapshot must be a string.' };
  }
  if (!isObject(value.metrics)) {
    return { ok: false, reason: 'M5 metrics must be an object.' };
  }
  return { ok: true };
}

function validateM6Output(value) {
  if (!isObject(value)) return { ok: false, reason: 'M6 output must be an object.' };
  if (typeof value.action_required !== 'boolean') {
    return { ok: false, reason: 'M6 action_required must be a boolean.' };
  }
  if (!Array.isArray(value.plan)) {
    return { ok: false, reason: 'M6 plan must be an array.' };
  }
  for (const step of value.plan) {
    if (!isObject(step) || !isString(step.action) || !isObject(step.args)) {
      return { ok: false, reason: 'M6 plan entries are malformed.' };
    }
  }
  return { ok: true };
}

module.exports = {
  validateM1Output,
  validateM4Output,
  validateM5Output,
  validateM6Output,
};
