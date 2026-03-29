'use strict';

const { ORCHESTRATION_CONFIG } = require('../config');
const { ACTION_DICTIONARY } = require('../actions/dictionary');
const { validateM6Output } = require('../schemas');
const { safeJsonParse } = require('../utils');

function buildPrompt({ userMessage, pageSnapshot }) {
  return `You are a browser action planner.
Decide if the user's request requires actions on the page.

User request: "${userMessage}"

Page snapshot:
${pageSnapshot}

Allowed actions:
${JSON.stringify(ACTION_DICTIONARY)}

Respond with JSON:
{
  "action_required": true | false,
  "plan": [{ "step": 1, "action": "action_name", "args": {}, "rationale": "..." }]
}`;
}

async function runM6({ state, runtimeChat }) {
  const prompt = buildPrompt({
    userMessage: state.user_message,
    pageSnapshot: (state.page_snapshot || '').slice(0, 20_000),
  });
  const response = await runtimeChat([{ role: 'user', content: prompt }]);
  const parsed = safeJsonParse(response?.content);
  const valid = validateM6Output(parsed);
  if (!valid.ok) {
    return { action_required: false, plan: [], fallback: true };
  }
  const plan = parsed.plan.slice(0, ORCHESTRATION_CONFIG.maxActionSteps).map((step, index) => ({
    step: Number(step.step) || index + 1,
    action: step.action,
    args: step.args || {},
    rationale: typeof step.rationale === 'string' ? step.rationale : '',
  }));
  return { action_required: parsed.action_required, plan, fallback: false };
}

module.exports = { runM6 };
