'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runM5 } = require('../src/ai/orchestration/modules/m5Budget');

function buildState(snapshot, message = 'find the main login form') {
  return {
    user_message: message,
    page_snapshot: snapshot,
  };
}

test('M5 keeps snapshot when already under budget', async () => {
  const state = buildState('# Title\n\nSmall content');
  const result = await runM5({
    state,
    runtimeChat: async () => ({ content: '[]' }),
  });

  assert.equal(result.pageSnapshot, state.page_snapshot);
  assert.equal(result.metrics.reductionLevel, 'none');
});

test('M5 reduction is deterministic for same input', async () => {
  const elementMap = new Array(500)
    .fill(0)
    .map((_, i) => `button#btn-${i} aria-label="Button ${i}" text="Open login panel ${i}"`)
    .join('\n');
  const largeSnapshot = `# Main\n\nContent\n## Visible Element Map\n${elementMap}`;
  const state = buildState(largeSnapshot);
  const runtimeChat = async () => ({ content: '["section-1"]' });

  const a = await runM5({ state, runtimeChat });
  const b = await runM5({ state, runtimeChat });

  assert.equal(a.pageSnapshot, b.pageSnapshot);
  assert.equal(a.metrics.reductionLevel, b.metrics.reductionLevel);
});
