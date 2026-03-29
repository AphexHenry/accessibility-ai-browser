'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateM1Output, validateM4Output, validateM6Output } = require('../src/ai/orchestration/schemas');

test('M1 schema accepts valid payload', () => {
  const result = validateM1Output({
    scope: 'general',
    confidence: 0.8,
    rationale: 'request is independent from page content',
  });
  assert.equal(result.ok, true);
});

test('M4 schema rejects invalid has_enough_info type', () => {
  const result = validateM4Output({
    has_enough_info: 'yes',
    missing: null,
    followup_question: null,
  });
  assert.equal(result.ok, false);
});

test('M6 schema accepts action plan', () => {
  const result = validateM6Output({
    action_required: true,
    plan: [
      {
        step: 1,
        action: 'highlight',
        args: { selector: '#main' },
      },
    ],
  });
  assert.equal(result.ok, true);
});
